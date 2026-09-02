import { createHash, randomUUID } from "node:crypto";
import * as cheerio from "cheerio";
import { Template, TemplateAsset } from "@/lib/db/contentEntities";
import { SiteImportJob, SiteImportPage } from "@/lib/db/importEntities";
import { ensureUniqueSlug } from "@/server/slugDynamo";
import { createBlogPost, updateBlogPost, findPostByExternalId } from "@/lib/blog/savePostDynamo";
import { convertHtmlToTiptapJson, tiptapJsonToHtml } from "@/lib/blogImport/htmlToTiptap";
import { createRedirectsForImportedPost } from "@/lib/blogImport/redirectsDynamo";
import { safeFetch } from "./fetchSafe";
import { detectPlatformFromHtml } from "./detect";
import { discoverSite, normalizeDiscoveredUrl } from "./crawl";
import { fetchRenderedHtml } from "./headlessFetch";
import { extractArticle } from "./extractArticle";
import { internalizeSameOriginAssets } from "./pageAssets";
import { rewriteLinksForPage } from "./linkRewriteDynamo";
import { getAdapter } from "./adapters";

// DynamoDB-stack port of lib/siteImport/runJob.ts — same behavior, same rationale on
// every function (see that file's comments), just backed by SiteImportJob/SiteImportPage/
// Template/TemplateAsset entity queries instead of Prisma. blog-post saves go through
// lib/blog/savePostDynamo.ts (not the Prisma savePost.ts) so an imported post that turns
// out to be a blog post lands in the same store everything else in this job does — mixing
// the two here would be exactly the ImportJob/Template split-brain this migration already
// got bitten by twice.

// Mirrors lib/blogImport/runBatchDynamo.ts's constants/reasoning: small batches because a
// single page can involve several sequential-ish network round trips (page fetch, N asset
// downloads); the stale-lock backstop is only for an invocation that died without
// releasing its claim.
const PAGES_PER_BATCH = 5;
const HEADLESS_PAGES_PER_BATCH = 1; // headless renders are 10x+ slower than a static fetch — see headlessFetch.ts
const BATCH_TIME_BUDGET_MS = 45_000; // safety margin inside Vercel's 60s maxDuration
const STALE_LOCK_MS = 5 * 60 * 1000;
const REWRITE_BATCH_SIZE = 20; // link rewriting is cheap (no network) — larger batches than FETCHING

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

function asUrlMap(value: unknown): Record<string, string> {
  return value && typeof value === "object" ? (value as Record<string, string>) : {};
}

function deriveNameFromUrl(url: string): string {
  const path = new URL(url).pathname.replace(/\/+$/, "");
  const last = path.split("/").filter(Boolean).pop();
  if (!last) return "Page";
  return last
    .replace(/\.(html?|php|aspx?)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || "Page";
}

/** Runs DETECTING+DISCOVERING as one combined step (both are cheap, single-pass operations — see doc comment below) and writes the resulting SiteImportPage rows. */
async function runDetectAndDiscover(job: { id: string; templateId: string; sourceUrl: string; platform: string }, warnings: string[]): Promise<void> {
  const homepageRes = await safeFetch(job.sourceUrl, { headers: { Accept: "text/html" } });
  if (!homepageRes.ok) throw new Error(`Couldn't reach ${job.sourceUrl} (${homepageRes.status}).`);
  const homepageHtml = await homepageRes.text();

  // Only auto-detect if the job wasn't created with an explicit platform override (stored as
  // the non-default value at creation time) — a manually-chosen "Generic HTML site" (UNKNOWN)
  // is indistinguishable from "no override given" here, a known, accepted v1 imprecision
  // (worst case: an explicit generic choice gets re-classified if the site matches a known
  // platform's signature) rather than adding a dedicated "was this locked" schema field for it.
  const platform = job.platform !== "UNKNOWN" ? job.platform : detectPlatformFromHtml(homepageHtml);

  const maxPages = 50; // see lib/siteImport's security hardening notes — Ultra-tier cap
  const { discovered, excluded } = await discoverSite(job.sourceUrl, homepageHtml, { maxPages });

  if (discovered.length === 0) {
    throw new Error("No pages could be discovered on that site (checked sitemap.xml, RSS/Atom feeds, and homepage links).");
  }

  // .create() (not .put()) is correct here — this only runs once per job, right after
  // DISCOVERING, so there's no resume/retry case that would re-write an already-existing
  // page row the way redirectsDynamo.ts's .put() handles for a resumed import batch.
  await Promise.all(
    discovered.map((d) =>
      SiteImportPage.create({ id: randomUUID(), jobId: job.id, sourceUrl: d.url, isBlogPost: d.likelyBlogPost }).go(),
    ),
  );

  // "Excluded" is routine, expected scope-limiting (a big site hitting the page cap is the
  // common case, easily hundreds of URLs) — never real errors, so they go to warnings, not
  // errors[]. Page-cap exclusions are summarized as one count rather than one line per URL
  // (confirmed against a real 900+-page site: one-line-per-URL made the report screen look
  // like something had gone badly wrong when nothing had). robots.txt exclusions are
  // typically few and specific enough to be worth listing individually.
  const capExcluded = excluded.filter((ex) => ex.reason === "page cap reached");
  const otherExcluded = excluded.filter((ex) => ex.reason !== "page cap reached");
  if (capExcluded.length > 0) {
    warnings.push(`${capExcluded.length} additional page(s) were beyond the ${maxPages}-page import cap and weren't imported.`);
  }
  for (const ex of otherExcluded) warnings.push(`${ex.reason}: ${ex.url}`);

  await SiteImportJob.patch({ templateId: job.templateId, id: job.id })
    .set({ platform: platform as any, totalPages: discovered.length, phase: "FETCHING", warnings })
    .go();
}

interface FetchOnePageResult {
  outcome: string;
  createdTemplateId?: string;
  createdBlogPostId?: string;
  usedHeadless: boolean;
  heuristicExtraction: boolean;
  interactiveFeatureFlags: string[];
  newPath?: string;
  error?: string;
}

async function fetchOneBlogPost(
  jobTemplateId: string,
  sourceUrl: string,
  platform: string,
): Promise<FetchOnePageResult> {
  const adapter = getAdapter(platform as any);
  const externalId = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 24);

  const structured = adapter.fetchBlogPostContent ? await adapter.fetchBlogPostContent(sourceUrl) : null;
  let bodyHtml: string;
  let title: string;
  let heuristicExtraction = false;
  let usedHeadless = false;
  let rawHtmlForFeatureScan = "";

  if (structured) {
    bodyHtml = structured.html;
    title = deriveNameFromUrl(sourceUrl);
  } else {
    const rendered = await fetchRenderedHtml(sourceUrl, { platformHint: platform as any, forceHeadless: adapter.needsHeadlessByDefault });
    usedHeadless = rendered.usedHeadless;
    rawHtmlForFeatureScan = rendered.html;
    const article = extractArticle(rendered.html, sourceUrl);
    if (!article) return { outcome: "FAILED", usedHeadless, heuristicExtraction: false, interactiveFeatureFlags: [], error: "Couldn't extract article content from this page." };
    bodyHtml = article.html;
    title = article.title;
    heuristicExtraction = true;
  }

  const contentJson = convertHtmlToTiptapJson(bodyHtml, { stripWpCruft: platform === "WORDPRESS" });
  const contentHtml = tiptapJsonToHtml(contentJson);
  const interactiveFeatureFlags = adapter.detectInteractiveFeatures(rawHtmlForFeatureScan || bodyHtml);

  const existing = await findPostByExternalId(jobTemplateId, externalId);
  const savePayload = {
    title,
    excerpt: structured?.excerpt ?? null,
    contentJson,
    contentHtml,
    featuredImageUrl: structured?.featuredImageUrl ?? null,
    status: "PUBLISHED" as const,
    externalId,
  };
  const savedPost = existing ? await updateBlogPost(jobTemplateId, existing.id, savePayload) : await createBlogPost(jobTemplateId, savePayload);
  if (!savedPost) return { outcome: "FAILED", usedHeadless, heuristicExtraction, interactiveFeatureFlags, error: "Failed to save post." };

  await createRedirectsForImportedPost(jobTemplateId, sourceUrl, 0, savedPost.slug).catch(() => {}); // best-effort — a redirect only matters if the old domain is later attached to this site

  return {
    outcome: "POST_CREATED",
    createdBlogPostId: savedPost.id,
    usedHeadless,
    heuristicExtraction,
    interactiveFeatureFlags,
    newPath: `/blog/${savedPost.slug}`,
  };
}

async function fetchOneRegularPage(
  job: { id: string; templateId: string; userId: string; organizationId: string; sourceUrl: string; platform: string },
  pageSourceUrl: string,
): Promise<FetchOnePageResult> {
  const adapter = getAdapter(job.platform as any);
  const rendered = await fetchRenderedHtml(pageSourceUrl, { platformHint: job.platform as any, forceHeadless: adapter.needsHeadlessByDefault });
  const { html: withoutAssetRefs, created: assetRows, warnings } = await internalizeSameOriginAssets(rendered.html, pageSourceUrl, job.id);
  const interactiveFeatureFlags = adapter.detectInteractiveFeatures(rendered.html);

  const isHomepage = normalizeDiscoveredUrl(pageSourceUrl, job.sourceUrl) === normalizeDiscoveredUrl(job.sourceUrl, job.sourceUrl);

  if (isHomepage) {
    await Template.patch({ id: job.templateId }).set({ sourceType: "RAW_UPLOAD", compiledHtml: withoutAssetRefs }).go();
    if (assetRows.length > 0) {
      await Promise.all(
        assetRows.map((a) =>
          TemplateAsset.create({
            id: randomUUID(),
            templateId: job.templateId,
            path: a.path,
            blobUrl: a.asset.blobUrl,
            contentType: a.asset.contentType,
            size: a.asset.size,
          }).go(),
        ),
      );
    }
    return { outcome: "PAGE_CREATED", createdTemplateId: job.templateId, usedHeadless: rendered.usedHeadless, heuristicExtraction: false, interactiveFeatureFlags, newPath: "/", error: warnings[0] };
  }

  const name = deriveNameFromUrl(pageSourceUrl);
  const slug = await ensureUniqueSlug(job.templateId, name);
  const childId = randomUUID();
  await Template.create({
    id: childId,
    userId: job.userId,
    organizationId: job.organizationId,
    name,
    kind: "LANDING_PAGE",
    sourceType: "RAW_UPLOAD",
    designJson: {},
    compiledHtml: withoutAssetRefs,
    parentId: job.templateId,
    slug,
    order: 0,
  }).go();
  if (assetRows.length > 0) {
    await Promise.all(
      assetRows.map((a) =>
        TemplateAsset.create({
          id: randomUUID(),
          templateId: childId,
          path: a.path,
          blobUrl: a.asset.blobUrl,
          contentType: a.asset.contentType,
          size: a.asset.size,
        }).go(),
      ),
    );
  }

  return { outcome: "PAGE_CREATED", createdTemplateId: childId, usedHeadless: rendered.usedHeadless, heuristicExtraction: false, interactiveFeatureFlags, newPath: `/${slug}`, error: warnings[0] };
}

async function runFetchingStep(
  job: { id: string; templateId: string; userId: string; organizationId: string; sourceUrl: string; platform: string; importBlogPosts: boolean; urlMap: unknown; processedPages: number },
  errors: string[],
): Promise<{ phase: string }> {
  const adapter = getAdapter(job.platform as any);
  const batchSize = adapter.needsHeadlessByDefault ? HEADLESS_PAGES_PER_BATCH : PAGES_PER_BATCH;

  const { data: allPages } = await SiteImportPage.query.primary({ jobId: job.id }).go();
  const pending = allPages.filter((p) => p.outcome === "PENDING").slice(0, batchSize);

  const urlMap = asUrlMap(job.urlMap);
  const start = Date.now();
  let processedCount = 0;

  for (const page of pending) {
    if (Date.now() - start > BATCH_TIME_BUDGET_MS) break;

    let result: FetchOnePageResult;
    try {
      result = page.isBlogPost && job.importBlogPosts
        ? await fetchOneBlogPost(job.templateId, page.sourceUrl, job.platform)
        : await fetchOneRegularPage(job, page.sourceUrl);
    } catch (err) {
      result = { outcome: "FAILED", usedHeadless: false, heuristicExtraction: false, interactiveFeatureFlags: [], error: err instanceof Error ? err.message : String(err) };
    }

    if (result.error && result.outcome !== "FAILED") errors.push(`${page.sourceUrl}: ${result.error}`);
    if (result.outcome === "FAILED") errors.push(`${page.sourceUrl} failed to import: ${result.error ?? "unknown error"}`);

    let patch = SiteImportPage.patch({ jobId: job.id, sourceUrl: page.sourceUrl }).set({
      outcome: result.outcome as any,
      usedHeadless: result.usedHeadless,
      heuristicExtraction: result.heuristicExtraction,
      interactiveFeatureFlags: result.interactiveFeatureFlags,
      ...(result.createdTemplateId ? { createdTemplateId: result.createdTemplateId } : {}),
      ...(result.createdBlogPostId ? { createdBlogPostId: result.createdBlogPostId } : {}),
      ...(result.outcome === "FAILED" ? { error: result.error ?? "unknown error" } : {}),
    });
    if (!result.createdTemplateId) patch = patch.remove(["createdTemplateId"]);
    if (!result.createdBlogPostId) patch = patch.remove(["createdBlogPostId"]);
    if (result.outcome !== "FAILED") patch = patch.remove(["error"]);
    await patch.go();

    if (result.newPath) urlMap[page.sourceUrl] = result.newPath;
    processedCount += 1;
  }

  const remaining = allPages.filter((p) => p.outcome === "PENDING").length - processedCount;
  const nextPhase = remaining <= 0 ? "REWRITING" : "FETCHING";

  await SiteImportJob.patch({ templateId: job.templateId, id: job.id })
    .set({ urlMap, processedPages: job.processedPages + processedCount, phase: nextPhase as any, errors })
    .go();

  return { phase: nextPhase };
}

async function runRewritingStep(job: { id: string; templateId: string; urlMap: unknown }): Promise<{ phase: string }> {
  const urlMap = asUrlMap(job.urlMap);
  const { data: allPages } = await SiteImportPage.query.primary({ jobId: job.id }).go();
  const pages = allPages
    .filter((p) => (p.outcome === "PAGE_CREATED" || p.outcome === "POST_CREATED") && !p.rewrittenAt)
    .slice(0, REWRITE_BATCH_SIZE);

  for (const page of pages) {
    await rewriteLinksForPage(job.templateId, page.createdTemplateId ?? null, page.createdBlogPostId ?? null, urlMap);
    await SiteImportPage.patch({ jobId: job.id, sourceUrl: page.sourceUrl }).set({ rewrittenAt: new Date().toISOString() }).go();
  }

  const remaining = allPages.filter(
    (p) => (p.outcome === "PAGE_CREATED" || p.outcome === "POST_CREATED") && !p.rewrittenAt,
  ).length - pages.length;
  const nextPhase = remaining <= 0 ? "COMPLETED" : "REWRITING";
  let patch = SiteImportJob.patch({ templateId: job.templateId, id: job.id }).set({ phase: nextPhase as any });
  patch = nextPhase === "COMPLETED" ? patch.set({ finishedAt: new Date().toISOString() }) : patch.remove(["finishedAt"]);
  await patch.go();
  return { phase: nextPhase };
}

const TERMINAL_PHASES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

/**
 * Processes exactly one bounded step of a site-import job and returns its resulting
 * phase — the direct analogue of lib/blogImport/runBatchDynamo.ts's processImportBatch,
 * using the identical atomic-claim pattern (only one invocation can hold the job at a
 * time) so the browser step-loop and the stalled-job cron never race the same
 * cursor/asset uploads.
 */
export async function processSiteImportStep(templateId: string, jobId: string): Promise<{ done: boolean; phase: string }> {
  const { data: existing } = await SiteImportJob.get({ templateId, id: jobId }).go();
  if (!existing) return { done: true, phase: "CANCELLED" };
  const existingPhase = existing.phase ?? "PENDING";
  if (TERMINAL_PHASES.has(existingPhase)) return { done: true, phase: existingPhase };

  const now = new Date().toISOString();
  const staleThreshold = new Date(Date.now() - STALE_LOCK_MS).toISOString();

  // Atomic claim — mirrors runBatchDynamo.ts's ImportJob claim exactly: claimable if not
  // already terminal (checked above) AND not currently held by another live invocation
  // (processing=false, or no heartbeat yet, or heartbeat stale).
  try {
    await SiteImportJob.patch({ templateId, id: jobId })
      .set({ processing: true, lastHeartbeatAt: now, startedAt: existing.startedAt ?? now })
      .where(
        (attr, op) =>
          `(${op.eq(attr.processing, false)} OR ${op.notExists(attr.lastHeartbeatAt)} OR ${op.lt(attr.lastHeartbeatAt, staleThreshold)})`,
      )
      .go();
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      const { data: current } = await SiteImportJob.get({ templateId, id: jobId }).go();
      return { done: true, phase: current?.phase ?? "CANCELLED" };
    }
    throw err;
  }

  const { data: jobRaw } = await SiteImportJob.get({ templateId, id: jobId }).go();
  if (!jobRaw) return { done: true, phase: "CANCELLED" };
  const job = {
    ...jobRaw,
    phase: jobRaw.phase ?? "PENDING",
    platform: jobRaw.platform ?? "UNKNOWN",
    urlMap: jobRaw.urlMap ?? {},
    processedPages: jobRaw.processedPages ?? 0,
    importBlogPosts: jobRaw.importBlogPosts ?? false,
  };
  const errors = asStringArray(job.errors);
  const warnings = asStringArray(job.warnings);

  try {
    let resultPhase: string;

    if (job.phase === "PENDING" || job.phase === "DETECTING" || job.phase === "DISCOVERING") {
      await runDetectAndDiscover(job, warnings);
      resultPhase = "FETCHING";
    } else if (job.phase === "FETCHING") {
      if (!job.createdBy) throw new Error("Import job is missing its creator.");
      resultPhase = (await runFetchingStep({ ...job, userId: job.createdBy }, errors)).phase;
    } else if (job.phase === "REWRITING") {
      resultPhase = (await runRewritingStep(job)).phase;
    } else {
      resultPhase = job.phase;
    }

    await SiteImportJob.patch({ templateId, id: jobId }).set({ processing: false, lastHeartbeatAt: new Date().toISOString(), errors }).go();
    return { done: TERMINAL_PHASES.has(resultPhase), phase: resultPhase };
  } catch (err) {
    errors.push(`Step failed: ${err instanceof Error ? err.message : String(err)}`);
    await SiteImportJob.patch({ templateId, id: jobId })
      .set({ phase: "PAUSED_ERROR", processing: false, errors, lastHeartbeatAt: new Date().toISOString() })
      .go();
    return { done: false, phase: "PAUSED_ERROR" };
  }
}
