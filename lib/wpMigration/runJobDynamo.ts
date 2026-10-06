import { createHash, randomUUID } from "node:crypto";
import pLimit from "p-limit";
import type { EntityItem } from "electrodb";
import { Template, BlogSite, BlogCategory, BlogTag, BlogRedirect } from "@/lib/db/contentEntities";
import { WpMigrationJob, WpMigrationPage, WpMigrationAsset } from "@/lib/db/importEntities";
import { createBlogPost, updateBlogPost, findPostByExternalId } from "@/lib/blog/savePostDynamo";
import { normalizeRedirectPath } from "@/lib/blog/redirectsDynamo";
import { findOrCreateAuthor, findOrCreateCategory, findOrCreateTag } from "@/lib/blogImport/taxonomyDynamo";
import { extractImageUrls, rehostMediaUrls, rewriteImageUrls } from "@/lib/blogImport/mediaRehostDynamo";
import { convertWordPressHtmlToTiptapJson, tiptapJsonToHtml } from "@/lib/blogImport/htmlToTiptap";
import { discoverWordPressInstall } from "./discover";
import { buildInventory } from "./inventory";
import { extractSourceFacts, transformPage } from "./htmlTransform";
import { fetchSourceAsset, storeMigratedAsset } from "./assets";
import { buildPluginReport, pluginSlugsFromHtml } from "./pluginCatalog";
import { migrationFetch } from "./http";
import { makeOriginRewriter, pageKey, pageKeyForUrl, pathSegments, resolveAssetOwner } from "./urlSpace";
import { buildMigrationReport } from "./report";
import type { DetectedPlugin, WpInstall, WpPostEntry, WpTermEntry } from "./types";

// The WordPress migration as a resumable, step-at-a-time job — same execution model as
// lib/siteImport/runJobDynamo.ts (the dashboard tab drives it step by step; a daily cron
// resumes any job whose tab was closed; an atomic claim stops the two from racing).
//
//   PLANNING   discover WordPress, read its full inventory, build the page tree, write redirects
//   POSTS      posts → Plexo Blog (first, so pages can link straight to the final blog URLs)
//   PAGES      every page → its node in the tree, exactly as WordPress rendered it
//   ASSETS     every file those pages load → mirrored path (recursing into CSS)
//   FINALIZING link-integrity check (re-entering PAGES for any real page the inventory
//              missed), plugin report, verification report
//
// Each step is bounded by STEP_BUDGET_MS so it fits inside a single serverless invocation.

const STEP_BUDGET_MS = 40_000;
const STALE_LOCK_MS = 5 * 60 * 1000;
const PAGES_PER_STEP = 4;
const POSTS_PER_STEP = 4;
const ASSET_CONCURRENCY = 6;
const ASSETS_PER_STEP = 150;
// Pages found by following links that the REST inventory didn't list (custom post types,
// archives a plugin generates). Bounded so a site with an unbounded URL space (faceted
// search, calendars) can't keep a job alive forever.
const MAX_EXTRA_PAGES = 60;
const MAX_DISCOVERY_ROUNDS = 3;
/** discoveredFrom prefix marking a speculative lazy-load candidate (lazyAssets.ts) — a miss isn't an error. */
const OPTIONAL_PREFIX = "optional:";

export interface PlanState {
  origin: string;
  homeKey: string;
  siteName: string;
  terms: WpTermEntry[];
  /** Hash of what the source host serves for a URL that can't exist — detects catch-all "soft 404" hosting. */
  soft404Hash: string | null;
  discoveryRounds: number;
  extraPages: number;
}

export interface MigrationCounts {
  pages: number;
  pagesDone: number;
  pagesFailed: number;
  posts: number;
  postsDone: number;
  postsFailed: number;
  assets: number;
  assetsDone: number;
  assetsFailed: number;
  assetsSkipped: number;
}

type JobItem = EntityItem<typeof WpMigrationJob>;
type PageItem = EntityItem<typeof WpMigrationPage>;

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

function emptyCounts(): MigrationCounts {
  return { pages: 0, pagesDone: 0, pagesFailed: 0, posts: 0, postsDone: 0, postsFailed: 0, assets: 0, assetsDone: 0, assetsFailed: 0, assetsSkipped: 0 };
}

function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

/** Where a page is served on Plexo: its key, plus the trailing slash if the original URL had one. */
function servedPath(key: string, sourceUrl: string): string {
  if (key === "/") return "/";
  return new URL(sourceUrl).pathname.endsWith("/") ? `${key}/` : key;
}

async function allPages(jobId: string): Promise<PageItem[]> {
  const { data } = await WpMigrationPage.query.primary({ jobId }).go({ pages: "all" });
  return data;
}

async function putRedirect(templateId: string, fromPath: string, toPath: string): Promise<void> {
  const from = normalizeRedirectPath(fromPath);
  if (from === normalizeRedirectPath(toPath) || from === "/") return;
  await BlogRedirect.put({ id: randomUUID(), templateId, fromPath: from, toPath }).go();
}

async function enqueueAsset(jobId: string, path: string, discoveredFrom: string): Promise<boolean> {
  try {
    await WpMigrationAsset.create({ id: randomUUID(), jobId, path, discoveredFrom, status: "PENDING" }).go();
    return true;
  } catch (err) {
    if (isConditionalCheckFailure(err)) return false; // already queued by another page
    throw err;
  }
}

/** Creates (or, on a retried PLANNING step, reuses) the Template node for a page key. */
async function ensureNode(
  job: JobItem,
  nodes: Record<string, string>,
  key: string,
  name: string,
  order: number,
  placeholderTarget?: string,
): Promise<string> {
  if (nodes[key]) return nodes[key];
  const segments = key.split("/").filter(Boolean);
  const parentKey = pageKey(segments.slice(0, -1));
  const parentId = nodes[parentKey];
  if (!parentId) throw new Error(`Parent page ${parentKey} missing while building ${key}`);
  const slug = segments[segments.length - 1];

  const { data: siblings } = await Template.query.byParent({ parentId }).go({ pages: "all" });
  const existing = siblings.find((s) => s.slug === slug);
  if (existing) {
    nodes[key] = existing.id;
    return existing.id;
  }

  const id = randomUUID();
  // A path segment WordPress never had a page for (only its children exist) still needs a
  // node for the tree walk to descend through; it forwards visitors to the nearest real page.
  const placeholderHtml = placeholderTarget
    ? `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${placeholderTarget}"><title>${name}</title></head><body><a href="${placeholderTarget}">Continue</a></body></html>`
    : "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Migrating…</title></head><body></body></html>";
  await Template.create({
    id,
    userId: job.createdBy,
    organizationId: job.organizationId,
    name: name || slug,
    kind: "LANDING_PAGE",
    sourceType: "RAW_UPLOAD",
    designJson: {},
    compiledHtml: placeholderHtml,
    parentId,
    slug,
    order,
  }).go();
  nodes[key] = id;
  return id;
}

async function runPlanning(job: JobItem, warnings: string[]): Promise<void> {
  const install: WpInstall = (job.install as WpInstall | undefined) ?? (await discoverWordPressInstall(job.sourceUrl));
  const inventory = await buildInventory(install);
  const origin = install.origin;
  const homeKey = pageKeyForUrl(install.homeUrl);

  // A host that answers every unknown URL with a 200 page (this case study's does — every
  // missing path returns the splash page) would make "does this linked page exist?" lie.
  // Fingerprint what a guaranteed-nonexistent URL returns so FINALIZING can tell.
  let soft404Hash: string | null = null;
  try {
    const probe = await migrationFetch(`${origin}/plexo-migration-probe-${randomUUID()}`, { headers: { Accept: "text/html" } });
    if (probe.ok) soft404Hash = hashBody(await probe.text());
  } catch {
    // unreachable probe just means no fingerprint
  }

  // ── Page tree: static pages + WordPress pages, keyed by their exact path.
  type Planned = { key: string; url: string; title: string; kind: "WP_PAGE" | "STATIC_PAGE"; wpId?: number; order: number };
  const planned = new Map<string, Planned>();
  inventory.install.staticPages.forEach((url, i) =>
    planned.set(pageKeyForUrl(url), { key: pageKeyForUrl(url), url, title: "", kind: "STATIC_PAGE", order: i }),
  );
  for (const p of inventory.pages) {
    const key = pageKeyForUrl(p.link);
    // A WordPress page wins over a static page at the same path (it's the richer source).
    planned.set(key, { key, url: p.link, title: p.title, kind: "WP_PAGE", wpId: p.id, order: p.menuOrder });
  }

  const nodes: Record<string, string> = { ...((job.nodes as Record<string, string> | undefined) ?? {}), "/": job.templateId };
  const keys = Array.from(planned.keys()).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  for (const key of keys) {
    const segments = key.split("/").filter(Boolean);
    // Ancestors with no page of their own.
    for (let depth = 1; depth < segments.length; depth++) {
      const ancestorKey = pageKey(segments.slice(0, depth));
      if (!planned.has(ancestorKey) && !nodes[ancestorKey]) {
        await ensureNode(job, nodes, ancestorKey, segments[depth - 1], 0, homeKey === "/" ? "/" : `${homeKey}/`);
      }
    }
    if (key !== "/") await ensureNode(job, nodes, key, planned.get(key)!.title, planned.get(key)!.order);
  }

  // If nothing at all lives at the domain root (WordPress in a subdirectory, no splash
  // page), the root forwards to the WordPress home — as close as possible to whatever the
  // source host did there.
  if (!planned.has("/")) {
    const target = `${homeKey}/`;
    await Template.patch({ id: job.templateId })
      .set({
        sourceType: "RAW_UPLOAD",
        compiledHtml: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${target}"><link rel="canonical" href="${origin}${target}"><title>${install.siteName}</title></head><body><a href="${target}">${install.siteName}</a></body></html>`,
      })
      .go();
  }

  await Promise.all(
    Array.from(planned.values()).map((p) =>
      WpMigrationPage.put({ id: randomUUID(), jobId: job.id, key: p.key, kind: p.kind, sourceUrl: p.url, title: p.title, wpId: p.wpId, templateId: nodes[p.key], status: "PENDING" }).go(),
    ),
  );

  // ── Posts become Plexo Blog posts; their old URLs are remembered so pages link straight to the new ones.
  const movedLinks: Record<string, string> = {};
  const limit = pLimit(8);
  await Promise.all(
    inventory.posts.map((post) =>
      limit(async () => {
        movedLinks[pageKeyForUrl(post.link)] = `/blog/${post.slug}`;
        await WpMigrationPage.put({ id: randomUUID(), jobId: job.id, key: `post:${post.id}`, kind: "POST", sourceUrl: post.link, title: post.title, wpId: post.id, status: "PENDING", data: post }).go();
      }),
    ),
  );
  if (inventory.posts.length > 0) {
    const { data: blogSite } = await BlogSite.get({ templateId: job.templateId }).go();
    if (!blogSite) await BlogSite.create({ id: randomUUID(), templateId: job.templateId, enabled: true, title: "Blog", description: install.siteDescription || undefined }).go();
    else if (!blogSite.enabled) await BlogSite.patch({ templateId: job.templateId }).set({ enabled: true }).go();
  }

  // ── Redirects for every WordPress URL that doesn't map 1:1 onto a page.
  const redirects: [string, string][] = [];
  const homePrefix = homeKey === "/" ? "" : homeKey;
  for (const p of inventory.pages) {
    const target = servedPath(pageKeyForUrl(p.link), p.link);
    redirects.push([`${homePrefix}/?page_id=${p.id}`, target]);
  }
  for (const feed of ["/feed", "/comments/feed", "/rss", "/feed/rss2", "/feed/atom"]) redirects.push([`${homePrefix}${feed}`, "/blog/feed.xml"]);
  for (const sitemap of ["/sitemap_index.xml", "/wp-sitemap.xml", "/page-sitemap.xml", "/post-sitemap.xml", "/category-sitemap.xml", "/post_tag-sitemap.xml", "/author-sitemap.xml", "/sitemap.xml"]) {
    if (`${homePrefix}${sitemap}` !== "/sitemap.xml") redirects.push([`${homePrefix}${sitemap}`, "/sitemap.xml"]);
  }
  // Attachment pages (Yoast's default already redirects these to the file itself).
  for (const m of inventory.media) {
    if (!m.link) continue;
    try {
      const fileKey = pageKeyForUrl(m.sourceUrl);
      if (pageKeyForUrl(m.link) !== fileKey) redirects.push([pageKeyForUrl(m.link), fileKey]);
    } catch {
      // malformed media link
    }
  }
  await Promise.all(redirects.map(([from, to]) => limit(() => putRedirect(job.templateId, from, to))));

  // ── The full media library, not just what pages reference — nothing in it is lost.
  let mediaQueued = 0;
  await Promise.all(
    inventory.media.map((m) =>
      limit(async () => {
        try {
          const segments = pathSegments(m.sourceUrl);
          if (new URL(m.sourceUrl).origin !== origin || segments.length === 0) return;
          if (await enqueueAsset(job.id, segments.join("/"), "media-library")) mediaQueued += 1;
        } catch {
          // a media URL on another host (offloaded to a CDN) is left where it is
        }
      }),
    ),
  );

  if (inventory.pages.length === 0 && inventory.posts.length === 0) {
    warnings.push("WordPress didn't list any public pages or posts — only pages reachable by links were copied.");
  }

  const counts = emptyCounts();
  counts.pages = planned.size;
  counts.posts = inventory.posts.length;
  counts.assets = mediaQueued;

  const planState: PlanState = {
    origin,
    homeKey,
    siteName: install.siteName,
    terms: inventory.terms,
    soft404Hash,
    discoveryRounds: 0,
    extraPages: 0,
  };

  await Template.patch({ id: job.templateId }).set({ migratedFrom: origin, ...(install.siteName ? { name: install.siteName } : {}) }).go();
  await WpMigrationJob.patch({ templateId: job.templateId, id: job.id })
    .set({ install, nodes, movedLinks, counts, planState, plugins: inventory.plugins, phase: "POSTS", warnings })
    .go();
}

async function runPostsStep(job: JobItem, errors: string[]): Promise<string> {
  const pages = await allPages(job.id);
  const pending = pages.filter((p) => p.kind === "POST" && p.status === "PENDING").slice(0, POSTS_PER_STEP);
  const plan = job.planState as PlanState;
  const counts = { ...emptyCounts(), ...(job.counts as MigrationCounts) };
  const movedLinks = { ...((job.movedLinks as Record<string, string>) ?? {}) };
  const rewriteOrigin = makeOriginRewriter(plan.origin);
  const started = Date.now();

  for (const row of pending) {
    if (Date.now() - started > STEP_BUDGET_MS) break;
    const post = row.data as WpPostEntry;
    try {
      const [categoryIds, tagIds, authorId] = await Promise.all([
        Promise.all(post.categoryNames.map((n) => findOrCreateCategory(job.templateId, n))),
        Promise.all(post.tagNames.map((n) => findOrCreateTag(job.templateId, n))),
        post.authorName ? findOrCreateAuthor(job.templateId, post.authorName, post.authorAvatarUrl) : Promise.resolve(null),
      ]);
      // Post images move to durable Plexo storage (and get Plexo's image optimization);
      // links inside the post follow the site to its new host.
      const imageUrls = [post.featuredImageUrl, post.seo.ogImage, ...extractImageUrls(post.contentHtml)].filter((u): u is string => Boolean(u));
      const mediaMap = await rehostMediaUrls(job.templateId, imageUrls, errors);
      let html = rewriteOrigin(rewriteImageUrls(post.contentHtml, mediaMap));
      for (const [from, to] of Object.entries(movedLinks)) {
        html = html.replace(new RegExp(`href=(["'])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?(["'#?])`, "g"), `href=$1${to}$2`);
      }
      const contentJson = convertWordPressHtmlToTiptapJson(html);
      const contentHtml = tiptapJsonToHtml(contentJson);
      const excerpt = post.excerptHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/\[&hellip;\]|\[…\]/g, "…").trim() || null;
      const payload = {
        title: post.title || "Untitled",
        slug: post.slug,
        excerpt,
        contentJson,
        contentHtml,
        featuredImageUrl: post.featuredImageUrl ? mediaMap.get(post.featuredImageUrl) ?? post.featuredImageUrl : null,
        featuredImageAlt: post.featuredImageAlt,
        status: "PUBLISHED" as const,
        authorId,
        categoryIds,
        tagIds,
        externalId: `wp:${post.id}`,
        publishedAtOverride: post.dateGmt,
        metaTitle: post.seo.title,
        metaDescription: post.seo.description,
        ogImageUrl: post.seo.ogImage ? mediaMap.get(post.seo.ogImage) ?? post.seo.ogImage : null,
        noindex: post.seo.robots?.index === "noindex",
      };
      const existing = await findPostByExternalId(job.templateId, `wp:${post.id}`);
      const saved = existing ? await updateBlogPost(job.templateId, existing.id, payload) : await createBlogPost(job.templateId, payload);
      if (!saved) throw new Error("Plexo couldn't save this post.");

      const newPath = `/blog/${saved.slug}`;
      movedLinks[pageKeyForUrl(post.link)] = newPath;
      await putRedirect(job.templateId, pageKeyForUrl(post.link), newPath);
      await putRedirect(job.templateId, `${plan.homeKey === "/" ? "" : plan.homeKey}/?p=${post.id}`, newPath);
      await WpMigrationPage.patch({ jobId: job.id, key: row.key })
        .set({ status: "DONE", newPath, blogPostId: saved.id, sourceFacts: { title: post.seo.title ?? post.title, metaDescription: post.seo.description, canonical: post.seo.canonical } })
        .go();
      counts.postsDone += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Post "${post.title}" couldn't be copied: ${message}`);
      await WpMigrationPage.patch({ jobId: job.id, key: row.key }).set({ status: "FAILED", error: message }).go();
      counts.postsFailed += 1;
    }
  }

  const stillPending = pages.filter((p) => p.kind === "POST" && p.status === "PENDING").length - pending.length;
  let next = "POSTS";
  if (stillPending <= 0) {
    // Category/tag archives → their Plexo Blog equivalents, now that the terms exist.
    const [{ data: categories }, { data: tags }] = await Promise.all([
      BlogCategory.query.primary({ templateId: job.templateId }).go({ pages: "all" }),
      BlogTag.query.primary({ templateId: job.templateId }).go({ pages: "all" }),
    ]);
    for (const term of plan.terms ?? []) {
      const list = term.taxonomy === "category" ? categories : tags;
      const match = list.find((t) => t.name.toLowerCase() === term.name.toLowerCase());
      const base = term.taxonomy === "category" ? "/blog/category" : "/blog/tag";
      await putRedirect(job.templateId, pageKeyForUrl(term.link), match ? `${base}/${match.slug}` : "/blog");
    }
    next = "PAGES";
  }
  await WpMigrationJob.patch({ templateId: job.templateId, id: job.id }).set({ counts, movedLinks, phase: next as "POSTS" }).go();
  return next;
}

async function runPagesStep(job: JobItem, errors: string[]): Promise<string> {
  const pages = await allPages(job.id);
  const pending = pages.filter((p) => p.kind !== "POST" && p.status === "PENDING").slice(0, PAGES_PER_STEP);
  const plan = job.planState as PlanState;
  const counts = { ...emptyCounts(), ...(job.counts as MigrationCounts) };
  const movedLinks = (job.movedLinks as Record<string, string>) ?? {};
  const started = Date.now();

  for (const row of pending) {
    if (Date.now() - started > STEP_BUDGET_MS) break;
    try {
      const res = await migrationFetch(row.sourceUrl, { headers: { Accept: "text/html" } });
      if (!res.ok) throw new Error(`WordPress answered ${res.status} for this page.`);
      const raw = await res.text();
      const path = servedPath(row.key, row.sourceUrl);
      const sourceFacts = extractSourceFacts(raw);
      const result = transformPage(raw, {
        origin: plan.origin,
        pageUrl: row.sourceUrl,
        pagePath: path,
        pageTitle: row.title || sourceFacts.title.split(/\s[-–|]\s/)[0] || "Website",
        siteTemplateId: job.templateId,
        movedLinks,
      });
      if (!row.templateId) throw new Error("This page has no place in the site tree.");
      await Template.patch({ id: row.templateId })
        .set({
          compiledHtml: result.html,
          sourceType: "RAW_UPLOAD",
          urlTrailingSlash: path.endsWith("/") && path !== "/",
          ...(row.title || sourceFacts.title ? { name: row.title || sourceFacts.title } : {}),
        })
        .go();

      const limit = pLimit(10);
      const added = await Promise.all(result.assetPaths.map((segs) => limit(() => enqueueAsset(job.id, segs.join("/"), row.key))));
      counts.assets += added.filter(Boolean).length;

      await WpMigrationPage.patch({ jobId: job.id, key: row.key })
        .set({
          status: "DONE",
          newPath: path,
          sourceFacts,
          newFacts: result.facts,
          forms: result.forms,
          unmigratedForms: result.unmigratedForms,
          internalLinks: result.internalLinks,
          pluginSlugs: Array.from(pluginSlugsFromHtml(raw)),
          assetCount: result.assetPaths.length,
        })
        .go();
      counts.pagesDone += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${row.sourceUrl} couldn't be copied: ${message}`);
      await WpMigrationPage.patch({ jobId: job.id, key: row.key }).set({ status: "FAILED", error: message }).go();
      counts.pagesFailed += 1;
    }
  }

  const stillPending = pages.filter((p) => p.kind !== "POST" && p.status === "PENDING").length - pending.length;
  const next = stillPending <= 0 ? "ASSETS" : "PAGES";
  await WpMigrationJob.patch({ templateId: job.templateId, id: job.id }).set({ counts, phase: next as "PAGES" }).go();
  return next;
}

async function runAssetsStep(job: JobItem): Promise<string> {
  const plan = job.planState as PlanState;
  const nodes = (job.nodes as Record<string, string>) ?? {};
  const pageKeys = new Set(Object.keys(nodes));
  const counts = { ...emptyCounts(), ...(job.counts as MigrationCounts) };
  const started = Date.now();
  const limit = pLimit(ASSET_CONCURRENCY);

  const { data: pending } = await WpMigrationAsset.query
    .primary({ jobId: job.id })
    .where((attr, op) => op.eq(attr.status, "PENDING"))
    .go({ pages: "all" });
  const batch = pending.slice(0, ASSETS_PER_STEP);

  await Promise.all(
    batch.map((asset) =>
      limit(async () => {
        if (Date.now() - started > STEP_BUDGET_MS) return;
        const segments = asset.path.split("/");
        const owner = resolveAssetOwner(pageKeys, segments);
        if (!owner || !nodes[owner.ownerKey]) {
          await WpMigrationAsset.patch({ jobId: job.id, path: asset.path }).set({ status: "SKIPPED", error: "Its address is the same as a page's" }).go();
          counts.assetsSkipped += 1;
          return;
        }
        const fetched = await fetchSourceAsset(plan.origin, segments);
        const optional = (asset.discoveredFrom ?? "").startsWith(OPTIONAL_PREFIX);
        if (!fetched.ok) {
          // An optional lazy-load candidate that doesn't exist simply isn't part of this site.
          if (optional) {
            await WpMigrationAsset.patch({ jobId: job.id, path: asset.path }).set({ status: "SKIPPED", error: "Optional plugin file this site doesn't use" }).go();
            counts.assetsSkipped += 1; // keeps the progress counter honest; the report leaves these out
            return;
          }
          await WpMigrationAsset.patch({ jobId: job.id, path: asset.path }).set({ status: fetched.skipped ? "SKIPPED" : "FAILED", error: fetched.reason }).go();
          if (fetched.skipped) counts.assetsSkipped += 1;
          else counts.assetsFailed += 1;
          return;
        }
        try {
          const stored = await storeMigratedAsset(job.id, nodes[owner.ownerKey], owner.relPath, fetched.buffer, fetched.contentType);
          await WpMigrationAsset.patch({ jobId: job.id, path: asset.path })
            .set({ status: "DONE", ownerTemplateId: nodes[owner.ownerKey], relPath: owner.relPath, contentType: fetched.contentType, size: stored.size })
            .go();
          counts.assetsDone += 1;
          for (const d of fetched.discovered) {
            if (await enqueueAsset(job.id, d.join("/"), asset.path)) counts.assets += 1;
          }
          for (const d of fetched.optional) {
            if (await enqueueAsset(job.id, d.join("/"), `${OPTIONAL_PREFIX}${asset.path}`)) counts.assets += 1;
          }
        } catch (err) {
          await WpMigrationAsset.patch({ jobId: job.id, path: asset.path })
            .set({ status: "FAILED", error: `Couldn't save to Plexo storage: ${err instanceof Error ? err.message : String(err)}` })
            .go();
          counts.assetsFailed += 1;
        }
      }),
    ),
  );

  const { data: remaining } = await WpMigrationAsset.query
    .primary({ jobId: job.id })
    .where((attr, op) => op.eq(attr.status, "PENDING"))
    .go({ pages: "all" });
  const next = remaining.length === 0 ? "FINALIZING" : "ASSETS";
  await WpMigrationJob.patch({ templateId: job.templateId, id: job.id }).set({ counts, phase: next as "ASSETS" }).go();
  return next;
}

function linkKey(href: string): string {
  const pathname = href.split(/[?#]/)[0];
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // keep
  }
  return decoded.length > 1 ? decoded.replace(/\/+$/, "") : "/";
}

async function runFinalizing(job: JobItem): Promise<string> {
  const plan = job.planState as PlanState;
  const nodes = { ...((job.nodes as Record<string, string>) ?? {}) };
  const pages = await allPages(job.id);
  const { data: assets } = await WpMigrationAsset.query.primary({ jobId: job.id }).go({ pages: "all" });
  const assetPaths = new Set(assets.filter((a) => a.status === "DONE").map((a) => `/${a.path}`));
  const blogPaths = new Set(pages.filter((p) => p.kind === "POST" && p.newPath).map((p) => p.newPath!));

  // ── Link integrity: every internal link on every migrated page must land somewhere.
  const unresolved = new Map<string, string>(); // link key → first page linking to it
  for (const page of pages) {
    for (const href of ((page.internalLinks as string[] | undefined) ?? [])) {
      const key = linkKey(href);
      if (nodes[key] || assetPaths.has(key) || blogPaths.has(key) || key.startsWith("/blog") || key.startsWith("/api/")) continue;
      if (!unresolved.has(key)) unresolved.set(key, page.key);
    }
  }
  const brokenLinks: { from: string; href: string; reason: string }[] = [];
  const toDiscover: string[] = [];
  for (const [key, from] of unresolved) {
    const { data: redirect } = await BlogRedirect.get({ templateId: job.templateId, fromPath: normalizeRedirectPath(key) }).go();
    if (redirect) continue;
    if (/\/wp-(admin|login)/.test(key)) {
      brokenLinks.push({ from, href: key, reason: "Links to the WordPress admin, which won't exist after you switch." });
      continue;
    }
    toDiscover.push(key);
  }

  // Real pages the REST inventory didn't list (custom post types, plugin-generated pages):
  // check the live source; anything that's genuinely a page gets migrated in another round.
  const plan2: PlanState = { ...plan };
  let added = 0;
  if (plan.discoveryRounds < MAX_DISCOVERY_ROUNDS) {
    for (const key of toDiscover) {
      if (plan2.extraPages + added >= MAX_EXTRA_PAGES) {
        brokenLinks.push({ from: unresolved.get(key)!, href: key, reason: "Not copied — the migration's extra-page limit was reached." });
        continue;
      }
      const url = `${plan.origin}${key === "/" ? "/" : `${encodeURI(key)}/`}`;
      let ok = false;
      let finalUrl = url;
      try {
        let res = await migrationFetch(url, { headers: { Accept: "text/html" } });
        if (res.status === 404) {
          // Some pages only exist without the trailing slash (a static file, a custom route).
          res = await migrationFetch(`${plan.origin}${encodeURI(key)}`, { headers: { Accept: "text/html" } });
          finalUrl = `${plan.origin}${encodeURI(key)}`;
        }
        if (res.ok && (res.headers.get("content-type") || "").includes("html")) {
          const body = await res.text();
          ok = !plan.soft404Hash || hashBody(body) !== plan.soft404Hash;
        }
      } catch {
        ok = false;
      }
      if (!ok) {
        brokenLinks.push({ from: unresolved.get(key)!, href: key, reason: "This link was already broken on your WordPress site." });
        continue;
      }
      const segments = key.split("/").filter(Boolean);
      for (let depth = 1; depth < segments.length; depth++) {
        const ancestor = pageKey(segments.slice(0, depth));
        if (!nodes[ancestor]) await ensureNode(job, nodes, ancestor, segments[depth - 1], 0, plan.homeKey === "/" ? "/" : `${plan.homeKey}/`);
      }
      const templateId = await ensureNode(job, nodes, key, segments[segments.length - 1] ?? "", 100);
      await WpMigrationPage.put({ id: randomUUID(), jobId: job.id, key, kind: "STATIC_PAGE", sourceUrl: finalUrl, title: "", templateId, status: "PENDING" }).go();
      added += 1;
    }
  }

  if (added > 0) {
    plan2.discoveryRounds += 1;
    plan2.extraPages += added;
    const counts = { ...emptyCounts(), ...(job.counts as MigrationCounts) };
    counts.pages += added;
    await WpMigrationJob.patch({ templateId: job.templateId, id: job.id }).set({ nodes, planState: plan2, counts, phase: "PAGES" }).go();
    return "PAGES";
  }

  // ── Plugins: everything seen on any page, not just the homepage.
  const assetSlugs = new Set<string>();
  for (const p of pages) for (const s of ((p.pluginSlugs as string[] | undefined) ?? [])) assetSlugs.add(s);
  const install = job.install as WpInstall;
  const plugins: DetectedPlugin[] = buildPluginReport(install.namespaces, assetSlugs);

  const report = buildMigrationReport({
    install,
    pages,
    assets,
    plugins,
    brokenLinks,
    counts: { ...emptyCounts(), ...(job.counts as MigrationCounts) },
  });

  await Template.patch({ id: job.templateId }).set({ migratedFrom: plan.origin }).go();
  await WpMigrationJob.patch({ templateId: job.templateId, id: job.id })
    .set({ plugins, report, phase: "COMPLETED", finishedAt: new Date().toISOString() })
    .go();
  return "COMPLETED";
}

/**
 * Processes exactly one bounded step of a migration and returns the resulting phase —
 * same atomic-claim contract as lib/siteImport/runJobDynamo.ts's processSiteImportStep.
 */
export async function processWpMigrationStep(templateId: string, jobId: string): Promise<{ done: boolean; phase: string }> {
  const { data: existing } = await WpMigrationJob.get({ templateId, id: jobId }).go();
  if (!existing) return { done: true, phase: "CANCELLED" };
  const existingPhase = existing.phase ?? "PENDING";
  if (TERMINAL.has(existingPhase)) return { done: true, phase: existingPhase };

  const now = new Date().toISOString();
  const staleThreshold = new Date(Date.now() - STALE_LOCK_MS).toISOString();
  try {
    await WpMigrationJob.patch({ templateId, id: jobId })
      .set({ processing: true, lastHeartbeatAt: now, startedAt: existing.startedAt ?? now })
      .where((attr, op) => `(${op.eq(attr.processing, false)} OR ${op.notExists(attr.lastHeartbeatAt)} OR ${op.lt(attr.lastHeartbeatAt, staleThreshold)})`)
      .go();
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      const { data: current } = await WpMigrationJob.get({ templateId, id: jobId }).go();
      return { done: false, phase: current?.phase ?? "CANCELLED" };
    }
    throw err;
  }

  const { data: job } = await WpMigrationJob.get({ templateId, id: jobId }).go();
  if (!job) return { done: true, phase: "CANCELLED" };
  const errors = Array.isArray(job.errors) ? [...(job.errors as string[])] : [];
  const warnings = Array.isArray(job.warnings) ? [...(job.warnings as string[])] : [];
  // A paused job resumes from the phase it paused in (kept in planState by the catch below).
  const phase = job.phase === "PAUSED_ERROR" ? ((job.planState as { pausedIn?: string } | undefined)?.pausedIn ?? "PLANNING") : (job.phase ?? "PENDING");

  try {
    let next: string;
    if (phase === "PENDING" || phase === "PLANNING") {
      await runPlanning(job, warnings);
      next = "POSTS";
    } else if (phase === "POSTS") {
      next = await runPostsStep(job, errors);
    } else if (phase === "PAGES") {
      next = await runPagesStep(job, errors);
    } else if (phase === "ASSETS") {
      next = await runAssetsStep(job);
    } else if (phase === "FINALIZING") {
      next = await runFinalizing(job);
    } else {
      next = phase;
    }
    await WpMigrationJob.patch({ templateId, id: jobId }).set({ processing: false, lastHeartbeatAt: new Date().toISOString(), errors: errors.slice(-200) }).go();
    return { done: TERMINAL.has(next), phase: next };
  } catch (err) {
    errors.push(`${phase === "PLANNING" || phase === "PENDING" ? "Reading your WordPress site" : `The ${phase.toLowerCase()} step`} stopped: ${err instanceof Error ? err.message : String(err)}`);
    await WpMigrationJob.patch({ templateId, id: jobId })
      .set({
        phase: "PAUSED_ERROR",
        processing: false,
        errors: errors.slice(-200),
        lastHeartbeatAt: new Date().toISOString(),
        planState: { ...((job.planState as object | undefined) ?? {}), pausedIn: phase === "PENDING" ? "PLANNING" : phase },
      })
      .go();
    return { done: false, phase: "PAUSED_ERROR" };
  }
}

