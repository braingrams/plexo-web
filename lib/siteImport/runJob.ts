import { createHash, randomUUID } from "node:crypto";
import * as cheerio from "cheerio";
import { BlogPostStatus, SiteImportPageOutcome, SiteImportPhase, SiteImportPlatform } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { ensureUniqueSlug } from "@/server/slug";
import { createBlogPost, updateBlogPost, findPostByExternalId } from "@/lib/blog/savePost";
import { convertHtmlToTiptapJson, tiptapJsonToHtml } from "@/lib/blogImport/htmlToTiptap";
import { createRedirectsForImportedPost } from "@/lib/blogImport/redirects";
import { safeFetch } from "./fetchSafe";
import { detectPlatformFromHtml } from "./detect";
import { discoverSite, normalizeDiscoveredUrl } from "./crawl";
import { fetchRenderedHtml } from "./headlessFetch";
import { extractArticle } from "./extractArticle";
import { internalizeSameOriginAssets } from "./pageAssets";
import { rewriteLinksForPage } from "./linkRewrite";
import { getAdapter } from "./adapters";

// Mirrors lib/blogImport/runBatch.ts's constants/reasoning: small batches because a single
// page can involve several sequential-ish network round trips (page fetch, N asset
// downloads); the stale-lock backstop is only for an invocation that died without releasing
// its claim.
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
async function runDetectAndDiscover(job: { id: string; sourceUrl: string; platform: SiteImportPlatform }, errors: string[]): Promise<void> {
  const homepageRes = await safeFetch(job.sourceUrl, { headers: { Accept: "text/html" } });
  if (!homepageRes.ok) throw new Error(`Couldn't reach ${job.sourceUrl} (${homepageRes.status}).`);
  const homepageHtml = await homepageRes.text();

  // Only auto-detect if the job wasn't created with an explicit platform override (stored as
  // the non-default value at creation time) — a manually-chosen "Generic HTML site" (UNKNOWN)
  // is indistinguishable from "no override given" here, a known, accepted v1 imprecision
  // (worst case: an explicit generic choice gets re-classified if the site matches a known
  // platform's signature) rather than adding a dedicated "was this locked" schema field for it.
  const platform = job.platform !== SiteImportPlatform.UNKNOWN ? job.platform : detectPlatformFromHtml(homepageHtml);

  const maxPages = 50; // see lib/siteImport's security hardening notes — Ultra-tier cap
  const { discovered, excluded } = await discoverSite(job.sourceUrl, homepageHtml, { maxPages });

  if (discovered.length === 0) {
    throw new Error("No pages could be discovered on that site (checked sitemap.xml, RSS/Atom feeds, and homepage links).");
  }

  await prisma.siteImportPage.createMany({
    data: discovered.map((d) => ({ jobId: job.id, sourceUrl: d.url, isBlogPost: d.likelyBlogPost })),
    skipDuplicates: true,
  });

  for (const ex of excluded) errors.push(`${ex.reason}: ${ex.url}`);

  await prisma.siteImportJob.update({
    where: { id: job.id },
    data: { platform, totalPages: discovered.length, phase: SiteImportPhase.FETCHING },
  });
}

interface FetchOnePageResult {
  outcome: SiteImportPageOutcome;
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
  platform: SiteImportPlatform,
): Promise<FetchOnePageResult> {
  const adapter = getAdapter(platform);
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
    const rendered = await fetchRenderedHtml(sourceUrl, { platformHint: platform, forceHeadless: adapter.needsHeadlessByDefault });
    usedHeadless = rendered.usedHeadless;
    rawHtmlForFeatureScan = rendered.html;
    const article = extractArticle(rendered.html, sourceUrl);
    if (!article) return { outcome: SiteImportPageOutcome.FAILED, usedHeadless, heuristicExtraction: false, interactiveFeatureFlags: [], error: "Couldn't extract article content from this page." };
    bodyHtml = article.html;
    title = article.title;
    heuristicExtraction = true;
  }

  const contentJson = convertHtmlToTiptapJson(bodyHtml, { stripWpCruft: platform === SiteImportPlatform.WORDPRESS });
  const contentHtml = tiptapJsonToHtml(contentJson);
  const interactiveFeatureFlags = adapter.detectInteractiveFeatures(rawHtmlForFeatureScan || bodyHtml);

  const existing = await findPostByExternalId(jobTemplateId, externalId);
  const savePayload = {
    title,
    excerpt: structured?.excerpt ?? null,
    contentJson,
    contentHtml,
    featuredImageUrl: structured?.featuredImageUrl ?? null,
    status: BlogPostStatus.PUBLISHED,
    externalId,
  };
  const savedPost = existing ? await updateBlogPost(jobTemplateId, existing.id, savePayload) : await createBlogPost(jobTemplateId, savePayload);
  if (!savedPost) return { outcome: SiteImportPageOutcome.FAILED, usedHeadless, heuristicExtraction, interactiveFeatureFlags, error: "Failed to save post." };

  await createRedirectsForImportedPost(jobTemplateId, sourceUrl, 0, savedPost.slug).catch(() => {}); // best-effort — a redirect only matters if the old domain is later attached to this site

  return {
    outcome: SiteImportPageOutcome.POST_CREATED,
    createdBlogPostId: savedPost.id,
    usedHeadless,
    heuristicExtraction,
    interactiveFeatureFlags,
    newPath: `/blog/${savedPost.slug}`,
  };
}

async function fetchOneRegularPage(
  job: { id: string; templateId: string; userId: string; organizationId: string; sourceUrl: string; platform: SiteImportPlatform },
  pageSourceUrl: string,
): Promise<FetchOnePageResult> {
  const adapter = getAdapter(job.platform);
  const rendered = await fetchRenderedHtml(pageSourceUrl, { platformHint: job.platform, forceHeadless: adapter.needsHeadlessByDefault });
  const { html: withoutAssetRefs, created: assetRows, warnings } = await internalizeSameOriginAssets(rendered.html, pageSourceUrl, job.id);
  const interactiveFeatureFlags = adapter.detectInteractiveFeatures(rendered.html);

  const isHomepage = normalizeDiscoveredUrl(pageSourceUrl, job.sourceUrl) === normalizeDiscoveredUrl(job.sourceUrl, job.sourceUrl);

  if (isHomepage) {
    await prisma.template.update({
      where: { id: job.templateId },
      data: { sourceType: "RAW_UPLOAD", compiledHtml: withoutAssetRefs },
    });
    if (assetRows.length > 0) {
      await prisma.templateAsset.createMany({
        data: assetRows.map((a) => ({ templateId: job.templateId, path: a.path, blobUrl: a.asset.blobUrl, contentType: a.asset.contentType, size: a.asset.size })),
        skipDuplicates: true,
      });
    }
    return { outcome: SiteImportPageOutcome.PAGE_CREATED, createdTemplateId: job.templateId, usedHeadless: rendered.usedHeadless, heuristicExtraction: false, interactiveFeatureFlags, newPath: "/", error: warnings[0] };
  }

  const name = deriveNameFromUrl(pageSourceUrl);
  const slug = await ensureUniqueSlug(job.templateId, name);
  const childId = randomUUID();
  await prisma.template.create({
    data: {
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
    },
  });
  if (assetRows.length > 0) {
    await prisma.templateAsset.createMany({
      data: assetRows.map((a) => ({ templateId: childId, path: a.path, blobUrl: a.asset.blobUrl, contentType: a.asset.contentType, size: a.asset.size })),
      skipDuplicates: true,
    });
  }

  return { outcome: SiteImportPageOutcome.PAGE_CREATED, createdTemplateId: childId, usedHeadless: rendered.usedHeadless, heuristicExtraction: false, interactiveFeatureFlags, newPath: `/${slug}`, error: warnings[0] };
}

async function runFetchingStep(
  job: { id: string; templateId: string; userId: string; organizationId: string; sourceUrl: string; platform: SiteImportPlatform; importBlogPosts: boolean; urlMap: unknown; processedPages: number },
  errors: string[],
): Promise<{ phase: SiteImportPhase }> {
  const adapter = getAdapter(job.platform);
  const batchSize = adapter.needsHeadlessByDefault ? HEADLESS_PAGES_PER_BATCH : PAGES_PER_BATCH;

  const pending = await prisma.siteImportPage.findMany({
    where: { jobId: job.id, outcome: SiteImportPageOutcome.PENDING },
    take: batchSize,
    orderBy: { createdAt: "asc" },
  });

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
      result = { outcome: SiteImportPageOutcome.FAILED, usedHeadless: false, heuristicExtraction: false, interactiveFeatureFlags: [], error: err instanceof Error ? err.message : String(err) };
    }

    if (result.error && result.outcome !== SiteImportPageOutcome.FAILED) errors.push(`${page.sourceUrl}: ${result.error}`);
    if (result.outcome === SiteImportPageOutcome.FAILED) errors.push(`${page.sourceUrl} failed to import: ${result.error ?? "unknown error"}`);

    await prisma.siteImportPage.update({
      where: { id: page.id },
      data: {
        outcome: result.outcome,
        createdTemplateId: result.createdTemplateId ?? null,
        createdBlogPostId: result.createdBlogPostId ?? null,
        usedHeadless: result.usedHeadless,
        heuristicExtraction: result.heuristicExtraction,
        interactiveFeatureFlags: result.interactiveFeatureFlags,
        error: result.outcome === SiteImportPageOutcome.FAILED ? (result.error ?? "unknown error") : null,
      },
    });

    if (result.newPath) urlMap[page.sourceUrl] = result.newPath;
    processedCount += 1;
  }

  const remaining = await prisma.siteImportPage.count({ where: { jobId: job.id, outcome: SiteImportPageOutcome.PENDING } });
  const nextPhase = remaining === 0 ? SiteImportPhase.REWRITING : SiteImportPhase.FETCHING;

  await prisma.siteImportJob.update({
    where: { id: job.id },
    data: { urlMap, processedPages: job.processedPages + processedCount, phase: nextPhase, errors },
  });

  return { phase: nextPhase };
}

async function runRewritingStep(job: { id: string; urlMap: unknown }): Promise<{ phase: SiteImportPhase }> {
  const urlMap = asUrlMap(job.urlMap);
  const pages = await prisma.siteImportPage.findMany({
    where: {
      jobId: job.id,
      outcome: { in: [SiteImportPageOutcome.PAGE_CREATED, SiteImportPageOutcome.POST_CREATED] },
      rewrittenAt: null,
    },
    take: REWRITE_BATCH_SIZE,
    orderBy: { createdAt: "asc" },
  });

  for (const page of pages) {
    await rewriteLinksForPage(page.createdTemplateId, page.createdBlogPostId, urlMap);
    await prisma.siteImportPage.update({ where: { id: page.id }, data: { rewrittenAt: new Date() } });
  }

  const remaining = await prisma.siteImportPage.count({
    where: { jobId: job.id, outcome: { in: [SiteImportPageOutcome.PAGE_CREATED, SiteImportPageOutcome.POST_CREATED] }, rewrittenAt: null },
  });
  const nextPhase = remaining === 0 ? SiteImportPhase.COMPLETED : SiteImportPhase.REWRITING;
  await prisma.siteImportJob.update({ where: { id: job.id }, data: { phase: nextPhase, finishedAt: nextPhase === SiteImportPhase.COMPLETED ? new Date() : null } });
  return { phase: nextPhase };
}

const TERMINAL_PHASES: Set<SiteImportPhase> = new Set([SiteImportPhase.COMPLETED, SiteImportPhase.FAILED, SiteImportPhase.CANCELLED]);

/**
 * Processes exactly one bounded step of a site-import job and returns its resulting phase —
 * the direct analogue of lib/blogImport/runBatch.ts's processImportBatch, using the identical
 * atomic-claim pattern (only one invocation can hold the job at a time) so the browser
 * step-loop and the stalled-job cron never race the same cursor/asset uploads.
 */
export async function processSiteImportStep(jobId: string): Promise<{ done: boolean; phase: SiteImportPhase }> {
  const existing = await prisma.siteImportJob.findUnique({ where: { id: jobId } });
  if (!existing) return { done: true, phase: SiteImportPhase.CANCELLED };
  if (TERMINAL_PHASES.has(existing.phase)) return { done: true, phase: existing.phase };

  const claim = await prisma.siteImportJob.updateMany({
    where: {
      id: jobId,
      phase: { notIn: Array.from(TERMINAL_PHASES) },
      OR: [{ processing: false }, { lastHeartbeatAt: null }, { lastHeartbeatAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } }],
    },
    data: { processing: true, lastHeartbeatAt: new Date(), startedAt: existing.startedAt ?? new Date() },
  });
  if (claim.count === 0) {
    const current = await prisma.siteImportJob.findUnique({ where: { id: jobId } });
    return { done: true, phase: current?.phase ?? SiteImportPhase.CANCELLED };
  }

  const job = (await prisma.siteImportJob.findUnique({ where: { id: jobId } }))!;
  const errors = asStringArray(job.errors);

  try {
    let resultPhase: SiteImportPhase;

    if (job.phase === SiteImportPhase.PENDING || job.phase === SiteImportPhase.DETECTING || job.phase === SiteImportPhase.DISCOVERING) {
      await runDetectAndDiscover(job, errors);
      resultPhase = SiteImportPhase.FETCHING;
    } else if (job.phase === SiteImportPhase.FETCHING) {
      if (!job.createdBy) throw new Error("Import job is missing its creator.");
      resultPhase = (await runFetchingStep({ ...job, userId: job.createdBy }, errors)).phase;
    } else if (job.phase === SiteImportPhase.REWRITING) {
      resultPhase = (await runRewritingStep(job)).phase;
    } else {
      resultPhase = job.phase;
    }

    await prisma.siteImportJob.update({ where: { id: jobId }, data: { processing: false, lastHeartbeatAt: new Date(), errors } });
    return { done: TERMINAL_PHASES.has(resultPhase), phase: resultPhase };
  } catch (err) {
    errors.push(`Step failed: ${err instanceof Error ? err.message : String(err)}`);
    await prisma.siteImportJob.update({
      where: { id: jobId },
      data: { phase: SiteImportPhase.PAUSED_ERROR, processing: false, errors, lastHeartbeatAt: new Date() },
    });
    return { done: false, phase: SiteImportPhase.PAUSED_ERROR };
  }
}
