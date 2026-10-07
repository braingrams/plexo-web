import { createHash, randomUUID } from "node:crypto";
import pLimit from "p-limit";
import type { EntityItem } from "electrodb";
import { Template, BlogSite, BlogCategory, BlogTag, BlogRedirect, BlogComment } from "@/lib/db/contentEntities";
import { WpMigrationJob, WpMigrationPage, WpMigrationAsset } from "@/lib/db/importEntities";
// savePostCore, NOT savePostDynamo: this module is reachable from the MCP dispatcher, which
// is also bundled into the standalone SOL Lambda, where savePostDynamo's next/cache import
// can't resolve. Callers inside Next.js pass the real revalidateBlogPost in.
import { createBlogPost, updateBlogPost, findPostByExternalId, type RevalidateFn } from "@/lib/blog/savePostCore";
import { normalizeRedirectPath } from "@/lib/blog/redirectsDynamo";
import { ensureCategory, ensureTag, findOrCreateAuthor, findOrCreateCategory, findOrCreateTag } from "@/lib/blogImport/taxonomyDynamo";
import { extractImageUrls, rehostMediaUrls, rewriteImageUrls } from "@/lib/blogImport/mediaRehostDynamo";
import { convertWordPressHtmlToTiptapJson, tiptapJsonToHtml } from "@/lib/blogImport/htmlToTiptap";
import { discoverWordPressInstall } from "./discover";
import { buildInventory, decodeEntities, fetchMediaPage, fetchPostIndexPage, fetchPostsByIds, fetchTermsPage, type ApiPage } from "./inventory";
import { extractSourceFacts, transformPage, type DetectedDonationForm } from "./htmlTransform";
import { CommerceDonationCampaign, CommerceSettings } from "@/lib/db/commerceEntities";
import { ensureDonationsReady, resolveDonationGateway } from "@/lib/commerce/donations";
import { fetchSourceAsset, storeMigratedAsset } from "./assets";
import { buildPluginReport, pluginSlugsFromHtml } from "./pluginCatalog";
import { fetchJson, migrationFetch, restUrl } from "./http";
import { makeOriginRewriter, pageKey, pageKeyForUrl, pathSegments, resolveAssetOwner } from "./urlSpace";
import { buildMigrationReport } from "./report";
import type { DetectedPlugin, WpInstall, WpMediaEntry, WpPostEntry, WpPostStub, WpTermEntry } from "./types";
import * as cheerio from "cheerio";
import { imageStem, makePostListsLive, type KnownPost } from "./livePostLists";
import { listingLayoutFromWpHtml, postLayoutFromWpHtml, shellLayout, wpPageRole } from "./blogLayout";
import { convertWcPage, hasWcChrome, isWooCommerce, rewriteWcChrome, storePagesFromHtml, wcPageRole } from "./woocommerce";
import { buildStorePresentation, finishProductImport, importProductBatch, planWooCommerce, type WcPlanState } from "./storeImport";
import { convertGiveForms } from "./givewp";
import { notifyMigrationDone, notifyMigrationPaused } from "./notify";
import { slimForStorage } from "./slimHtml";

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

// No new work starts after this; what's in flight finishes (~10s), and the background
// hand-off (lib/wpMigration/background.ts, up to 10s) must still fit in the server's 60s.
const STEP_BUDGET_MS = 35_000;
const STALE_LOCK_MS = 5 * 60 * 1000;
const PAGES_PER_STEP = 4;
// Posts copied per step, a few at a time; the step's time budget is the real limit.
const POSTS_PER_STEP = 40;
const POST_CONCURRENCY = 4;
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
  /** Older jobs only: terms were kept here and redirected at the end of POSTS. New jobs redirect them while listing. */
  terms?: WpTermEntry[];
  /**
   * Planning's listing cursor: posts, categories, tags and media are read from WordPress one
   * page (100 items) at a time, across as many steps as a big site needs. Absent once done.
   */
  indexing?: { list: IndexList; page: number };
  /** Hash of what the source host serves for a URL that can't exist — detects catch-all "soft 404" hosting. */
  soft404Hash: string | null;
  discoveryRounds: number;
  extraPages: number;
  /** Custom-plugin read endpoints preserved as data at their original URL. */
  frozenApis?: string[];
  /** Custom-plugin submission endpoints whose POSTs now land in Form Submissions. */
  capturedApis?: string[];
  /** The blog's layouts/settings were derived from the WordPress theme (runs once). */
  blogPresentationDone?: boolean;
  /** A WooCommerce store being moved to Plexo Commerce (lib/wpMigration/storeImport.ts). */
  wc?: WcPlanState;
}

type IndexList = "posts" | "categories" | "tags" | "media";
const INDEX_ORDER: IndexList[] = ["posts", "categories", "tags", "media"];

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
  products?: number;
  productsDone?: number;
  productsSkipped?: number;
  productsFailed?: number;
}

type JobItem = EntityItem<typeof WpMigrationJob>;
type PageItem = EntityItem<typeof WpMigrationPage>;

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

const TRANSIENT_AWS_ERRORS = new Set([
  "ProvisionedThroughputExceededException",
  "ThrottlingException",
  "RequestLimitExceeded",
  "InternalServerError",
  "ServiceUnavailable",
  "TransactionConflictException",
  "TimeoutError",
]);

/** A temporary AWS hiccup (throttling, a blip) rather than something wrong with the site — worth simply retrying. */
export function isTransientAwsError(err: unknown): boolean {
  const e = err as { name?: string; message?: string; cause?: { name?: string } } | null;
  if (!e) return false;
  if (TRANSIENT_AWS_ERRORS.has(e.name ?? "") || TRANSIENT_AWS_ERRORS.has(e.cause?.name ?? "")) return true;
  return /Throughput exceeds|Rate exceeded|throttl/i.test(e.message ?? "");
}

const MAX_TRANSIENT_RETRIES = 5;
const PAUSE_EMAIL_EVERY_MS = 6 * 60 * 60 * 1000;

/** What the owner reads when a step stops — never a raw database error. */
export function stepErrorMessage(phase: string, err: unknown): string {
  const where = phase === "PLANNING" || phase === "PENDING" ? "Reading your WordPress site" : `The ${phase.toLowerCase()} step`;
  if (isTransientAwsError(err)) return `${where} paused because Plexo was briefly busy saving your site.`;
  const message = err instanceof Error ? err.message : String(err);
  if (/DynamoDB|electrodb/i.test(message)) return `${where} stopped because Plexo couldn't save part of your site.`;
  return `${where} stopped: ${message}`;
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

/** Saves files moved out of an oversized page (lib/wpMigration/slimHtml.ts) under the site's root page, served at /plexo-inline/… */
function inlineFileSaver(job: JobItem) {
  return async (relPath: string, body: Buffer, contentType: string) => {
    await storeMigratedAsset(job.id, job.templateId, relPath, body, contentType);
  };
}

/** A page's address on WordPress — what relative URLs inside it were relative to. */
function pathOf(url: string, fallback = "/"): string {
  try {
    return new URL(url).pathname;
  } catch {
    return fallback;
  }
}

/**
 * Old post URL → its Plexo Blog path, so copied pages and posts link straight to the new
 * post. Built from the post rows (a big blog's map would overflow the job record).
 */
function movedLinksFor(job: JobItem, pages: PageItem[]): Record<string, string> {
  const links: Record<string, string> = { ...((job.movedLinks as Record<string, string> | undefined) ?? {}) };
  for (const row of pages) {
    if (row.kind !== "POST") continue;
    const slug = (row.data as WpPostStub | undefined)?.slug;
    const target = row.newPath ?? (slug ? `/blog/${slug}` : null);
    if (target) links[pageKeyForUrl(row.sourceUrl)] = target;
  }
  return links;
}

/** Rewrites links to moved posts in one pass (one regex per post would be quadratic on a big blog). */
export function rewritePostLinks(html: string, movedLinks: Record<string, string>): string {
  return html.replace(/href=(["'])(\/[^"'#?]*)/g, (match, quote: string, path: string) => {
    let key = path;
    try {
      key = decodeURIComponent(path);
    } catch {
      // keep as-is
    }
    if (key.length > 1) key = key.replace(/\/+$/, "");
    const target = movedLinks[key];
    return target ? `href=${quote}${target}` : match;
  });
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
    migratedFrom: (job.install as WpInstall | undefined)?.origin,
  }).go();
  nodes[key] = id;
  return id;
}

const MAX_FROZEN_API_BYTES = 1024 * 1024;

async function adaptCustomApis(job: JobItem, install: WpInstall, nodes: Record<string, string>): Promise<{ frozenApis: string[]; capturedApis: string[] }> {
  const frozenApis: string[] = [];
  const capturedApis: string[] = [];
  // Plain-permalink installs expose the API only via ?rest_route=, which has no path of its
  // own to preserve — those endpoints are reported, not adapted.
  if (install.restRoot.includes("rest_route=")) return { frozenApis, capturedApis };
  const restPath = new URL(install.restRoot).pathname.replace(/\/+$/, "");
  const pageKeys = new Set(Object.keys(nodes));

  for (const r of install.customRoutes ?? []) {
    if (r.hasParams) continue;
    const publicPath = `${restPath}${r.route}`;
    if (r.methods.includes("POST")) capturedApis.push(publicPath);
    if (!r.methods.includes("GET")) continue;
    const res = await fetchJson<unknown>(restUrl(install.restRoot, r.route.slice(1))).catch(() => null);
    if (!res) continue; // needs a login, or errored — nothing public to preserve
    const body = Buffer.from(JSON.stringify(res.data), "utf8");
    if (body.byteLength > MAX_FROZEN_API_BYTES) continue;
    const owner = resolveAssetOwner(pageKeys, publicPath.split("/").filter(Boolean));
    if (!owner || !nodes[owner.ownerKey]) continue;
    await storeMigratedAsset(job.id, nodes[owner.ownerKey], owner.relPath, body, "application/json; charset=utf-8");
    frozenApis.push(publicPath);
  }
  if (capturedApis.length > 0) {
    await Template.patch({ id: job.templateId }).set({ migratedApiCaptureRoutes: capturedApis }).go();
  }
  return { frozenApis, capturedApis };
}

async function runPlanning(job: JobItem, warnings: string[]): Promise<string> {
  // Listing posts/terms/media already under way (a later planning step).
  if ((job.planState as PlanState | undefined)?.indexing) return runIndexing(job, warnings);
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

  const pageLimit = pLimit(8);

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
      pageLimit(() => WpMigrationPage.put({ id: randomUUID(), jobId: job.id, key: p.key, kind: p.kind, sourceUrl: p.url, title: p.title, wpId: p.wpId, templateId: nodes[p.key], status: "PENDING" }).go()),
    ),
  );

  const limit = pLimit(8);

  // ── A WooCommerce store: list its products (they move in their own step, after posts).
  const store = isWooCommerce(install) ? await planWooCommerce(job, install.restRoot).catch(() => null) : null;

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
  await Promise.all(redirects.map(([from, to]) => limit(() => putRedirect(job.templateId, from, to))));

  // ── Custom plugins' own API endpoints. Readable ones are preserved as data at exactly
  // the same URL (so an app or widget still reading them keeps working); ones that accepted
  // submissions are registered so the serve route captures them into Form Submissions.
  const { frozenApis, capturedApis } = await adaptCustomApis(job, install, nodes);

  const counts = emptyCounts();
  counts.pages = planned.size;
  if (store) counts.products = store.count;

  const planState: PlanState = {
    origin,
    homeKey,
    siteName: install.siteName,
    soft404Hash,
    discoveryRounds: 0,
    extraPages: 0,
    frozenApis,
    capturedApis,
    ...(store ? { wc: store.wc } : {}),
    // Posts, terms and media are listed next, a page at a time (runIndexing).
    indexing: { list: "posts", page: 1 },
  };

  await Template.patch({ id: job.templateId }).set({ migratedFrom: origin, ...(install.siteName ? { name: install.siteName } : {}) }).go();
  await WpMigrationJob.patch({ templateId: job.templateId, id: job.id })
    .set({ install, nodes, counts, planState, plugins: inventory.plugins, phase: "PLANNING", warnings })
    .go();
  return "PLANNING";
}

/**
 * Lists the site's posts, categories, tags and media library one WordPress page (100 items)
 * at a time, for as many steps as it takes — 9,000 posts is 90 small reads, never one
 * enormous one. Each page is saved with the cursor, so a retried step never double-counts.
 * Post rows hold only what's needed to place and link the post; its content is read when
 * it's copied (runPostsStep), so nothing big is written in a burst.
 */
async function runIndexing(job: JobItem, warnings: string[]): Promise<string> {
  const plan = job.planState as PlanState;
  const install = job.install as WpInstall;
  const counts = { ...emptyCounts(), ...(job.counts as MigrationCounts) };
  const limit = pLimit(8);
  const started = Date.now();
  let cursor = plan.indexing!;

  while (Date.now() - started < STEP_BUDGET_MS) {
    let page: ApiPage<unknown>;
    if (cursor.list === "posts") {
      const res = await fetchPostIndexPage(install.restRoot, cursor.page);
      await Promise.all(
        res.items.map((post) =>
          limit(() =>
            WpMigrationPage.put({ id: randomUUID(), jobId: job.id, key: `post:${post.id}`, kind: "POST", sourceUrl: post.link, title: post.title, wpId: post.id, status: "PENDING", data: post }).go(),
          ),
        ),
      );
      counts.posts += res.items.length;
      page = res;
    } else if (cursor.list === "categories" || cursor.list === "tags") {
      const res = await fetchTermsPage(install.restRoot, cursor.list === "categories" ? "category" : "post_tag", cursor.page);
      // The Plexo category/tag exists from the start, so its old archive URL can redirect now.
      // One at a time: two names that make the same slug must not race for it.
      for (const term of res.items) {
        const { slug } = term.taxonomy === "category" ? await ensureCategory(job.templateId, term.name) : await ensureTag(job.templateId, term.name);
        await putRedirect(job.templateId, pageKeyForUrl(term.link), `${term.taxonomy === "category" ? "/blog/category" : "/blog/tag"}/${slug}`);
      }
      page = res;
    } else {
      // The full media library, not just what pages reference — nothing in it is lost.
      const res = await fetchMediaPage(install.restRoot, cursor.page);
      const queued = await Promise.all(res.items.map((m) => limit(() => indexMedia(job, plan.origin, m))));
      counts.assets += queued.filter(Boolean).length;
      page = res;
    }

    const listDone = page.items.length === 0 || cursor.page >= page.totalPages;
    const nextList = INDEX_ORDER[INDEX_ORDER.indexOf(cursor.list) + 1];
    if (!listDone) cursor = { list: cursor.list, page: cursor.page + 1 };
    else if (nextList) cursor = { list: nextList, page: 1 };
    else {
      // Everything is listed.
      if (counts.posts > 0) {
        const { data: blogSite } = await BlogSite.get({ templateId: job.templateId }).go();
        if (!blogSite) await BlogSite.create({ id: randomUUID(), templateId: job.templateId, enabled: true, title: "Blog", description: install.siteDescription || undefined }).go();
        else if (!blogSite.enabled) await BlogSite.patch({ templateId: job.templateId }).set({ enabled: true }).go();
      }
      if (counts.pages === 0 && counts.posts === 0) {
        warnings.push("WordPress didn't list any public pages or posts — only pages reachable by links were copied.");
      }
      const { indexing: _done, ...rest } = plan;
      await WpMigrationJob.patch({ templateId: job.templateId, id: job.id }).set({ counts, planState: rest, phase: "POSTS", warnings }).go();
      return "POSTS";
    }
    await WpMigrationJob.patch({ templateId: job.templateId, id: job.id }).set({ counts, planState: { ...plan, indexing: cursor } }).go();
  }
  return "PLANNING";
}

/** Queues one media-library file for copying, and redirects its WordPress attachment page to the file. */
async function indexMedia(job: JobItem, origin: string, m: WpMediaEntry): Promise<boolean> {
  let segments: string[];
  let fileKey: string;
  try {
    segments = pathSegments(m.sourceUrl);
    fileKey = pageKeyForUrl(m.sourceUrl);
    if (m.link && pageKeyForUrl(m.link) !== fileKey) await putRedirect(job.templateId, pageKeyForUrl(m.link), fileKey);
    // A media URL on another host (offloaded to a CDN) is left where it is.
    if (new URL(m.sourceUrl).origin !== origin || segments.length === 0) return false;
  } catch (err) {
    if (err instanceof TypeError || err instanceof URIError) return false; // a malformed media URL
    throw err;
  }
  // A failed save here is a real error, not a file to drop silently.
  return enqueueAsset(job.id, segments.join("/"), "media-library");
}

/** Email used for imported comments until the companion plugin supplies the real one (WordPress never publishes commenter emails). */
export const IMPORTED_COMMENT_EMAIL = "commenter@wordpress-import.invalid";

/**
 * A post's approved comments, with replies kept threaded. WordPress publishes approved
 * comments through its public API, so this needs no plugin. Ids are derived from the
 * WordPress comment id, so a retried step never duplicates a comment.
 */
async function importApprovedComments(restRoot: string, wpPostId: number, plexoPostId: string): Promise<number> {
  type RawComment = { id: number; parent: number; author_name?: string; date_gmt?: string; content?: { rendered?: string } };
  const all: RawComment[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetchJson<RawComment[]>(restUrl(restRoot, "wp/v2/comments", { post: wpPostId, per_page: 100, page, orderby: "id", order: "asc", _fields: "id,parent,author_name,date_gmt,content" }));
    if (!res || !Array.isArray(res.data) || res.data.length === 0) break;
    all.push(...res.data);
    if (res.data.length < 100) break;
  }
  let imported = 0;
  for (const c of all) {
    const body = (c.content?.rendered ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n").replace(/<[^>]+>/g, "").trim();
    if (!body) continue;
    try {
      await BlogComment.create({
        id: `wp-${c.id}`,
        postId: plexoPostId,
        ...(c.parent ? { parentId: `wp-${c.parent}` } : {}),
        authorName: (c.author_name || "Anonymous").slice(0, 120),
        authorEmail: IMPORTED_COMMENT_EMAIL,
        body: body.slice(0, 5000),
        status: "APPROVED",
        ...(c.date_gmt ? { createdAt: `${c.date_gmt}Z` } : {}),
      }).go();
      imported += 1;
    } catch (err) {
      if (!isConditionalCheckFailure(err)) throw err;
    }
  }
  return imported;
}

const NOOP_REVALIDATE: RevalidateFn = async () => {};

async function runPostsStep(job: JobItem, errors: string[], revalidate: RevalidateFn): Promise<string> {
  const pages = await allPages(job.id);
  const pending = pages.filter((p) => p.kind === "POST" && p.status === "PENDING").slice(0, POSTS_PER_STEP);
  const plan = job.planState as PlanState;
  const counts = { ...emptyCounts(), ...(job.counts as MigrationCounts) };
  const movedLinks = movedLinksFor(job, pages);
  const rewriteOrigin = makeOriginRewriter(plan.origin);
  const started = Date.now();

  // The batch's full posts, in one read. (Older jobs carried each post on its row.)
  const isFull = (d: unknown): d is WpPostEntry => typeof (d as WpPostEntry | undefined)?.contentHtml === "string";
  const toFetch = pending.filter((r) => !isFull(r.data) && r.wpId).map((r) => r.wpId!);
  const fetched = new Map((await fetchPostsByIds((job.install as WpInstall).restRoot, toFetch)).map((p) => [p.id, p]));

  // A few posts at a time (each mostly waits on WordPress for its images), stopping
  // before the step's time budget runs out; whatever's left is the next step's.
  let processed = 0;
  const postLimit = pLimit(POST_CONCURRENCY);
  await Promise.all(pending.map((row) => postLimit(async () => {
    if (Date.now() - started > STEP_BUDGET_MS) return;
    processed += 1;
    const post = isFull(row.data) ? row.data : fetched.get(row.wpId ?? -1);
    if (!post) {
      // Unpublished or deleted on WordPress since planning.
      errors.push(`Post "${row.title || row.sourceUrl}" wasn't copied — WordPress no longer shows it publicly.`);
      await WpMigrationPage.patch({ jobId: job.id, key: row.key }).set({ status: "SKIPPED", error: "No longer public on WordPress" }).go();
      counts.postsFailed += 1;
      return;
    }
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
      const html = rewritePostLinks(rewriteOrigin(rewriteImageUrls(post.contentHtml, mediaMap)), movedLinks);
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
      const saved = existing ? await updateBlogPost(job.templateId, existing.id, payload, revalidate) : await createBlogPost(job.templateId, payload, revalidate);
      if (!saved) throw new Error("Plexo couldn't save this post.");

      const commentsImported = await importApprovedComments((job.install as WpInstall).restRoot, post.id, saved.id).catch(() => 0);
      const newPath = `/blog/${saved.slug}`;
      movedLinks[pageKeyForUrl(post.link)] = newPath;
      await putRedirect(job.templateId, pageKeyForUrl(post.link), newPath);
      await putRedirect(job.templateId, `${plan.homeKey === "/" ? "" : plan.homeKey}/?p=${post.id}`, newPath);
      await WpMigrationPage.patch({ jobId: job.id, key: row.key })
        // The row keeps the post minus its body: the blog-list matcher needs title, excerpt,
        // image, date and terms, and the body is already in Plexo.
        .set({ status: "DONE", newPath, blogPostId: saved.id, commentCount: commentsImported, data: { ...post, contentHtml: "" }, sourceFacts: { title: post.seo.title ?? post.title, metaDescription: post.seo.description, canonical: post.seo.canonical } })
        .go();
      counts.postsDone += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isTransientAwsError(err)) throw err; // retried as a whole step, not marked failed
      errors.push(`Post "${post.title}" couldn't be copied: ${message}`);
      await WpMigrationPage.patch({ jobId: job.id, key: row.key }).set({ status: "FAILED", error: message }).go();
      counts.postsFailed += 1;
    }
  })));

  const stillPending = pages.filter((p) => p.kind === "POST" && p.status === "PENDING").length - processed;
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
    // A store's products move next (before pages, so product links resolve while copying).
    next = plan.wc && !plan.wc.productsFinished ? "PRODUCTS" : "PAGES";
  }
  await WpMigrationJob.patch({ templateId: job.templateId, id: job.id }).set({ counts, phase: next as "POSTS" }).go();
  return next;
}

function friendlyName(name: string): string {
  // Headings are often styled in capitals in the source markup ("BECOME A PARTNER"); a
  // campaign name reads better in the dashboard and receipts in title case.
  return name === name.toUpperCase() ? name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : name;
}

async function ensureMigratedCampaign(job: JobItem, form: DetectedDonationForm & { goalMinor?: number | null }): Promise<{ campaignId: string; name: string }> {
  const { data: campaigns } = await CommerceDonationCampaign.query.primary({ templateId: job.templateId }).go({ pages: "all" });
  const existing = campaigns.find((c) => c.source === form.source);
  if (existing) return { campaignId: existing.id, name: existing.name };
  await ensureDonationsReady(job.templateId, job.organizationId, job.createdBy, { currency: form.currency });
  const id = randomUUID();
  const name = friendlyName(form.name).slice(0, 120);
  await CommerceDonationCampaign.create({
    id,
    templateId: job.templateId,
    organizationId: job.organizationId,
    name,
    presetAmounts: form.presets,
    defaultPresetIndex: form.defaultPresetIndex,
    allowCustomAmount: form.allowCustomAmount,
    minAmountMinor: form.minAmountMinor,
    allowMonthly: form.allowMonthly,
    buttonLabel: form.buttonLabel ?? undefined,
    source: form.source,
    ...(form.goalMinor ? { goalAmountMinor: form.goalMinor } : {}),
  }).go();
  return { campaignId: id, name };
}

async function runProductsStep(job: JobItem, errors: string[]): Promise<string> {
  const plan = job.planState as PlanState;
  if (!plan.wc) return "PAGES";
  const rows = await allPages(job.id);
  const done = await importProductBatch(job, rows, errors);
  const after = await allPages(job.id);
  const products = after.filter((r) => r.kind === "PRODUCT");
  const counts = { ...emptyCounts(), ...(job.counts as MigrationCounts) };
  counts.productsDone = products.filter((r) => r.status === "DONE").length;
  counts.productsSkipped = products.filter((r) => r.status === "SKIPPED").length;
  counts.productsFailed = products.filter((r) => r.status === "FAILED").length;
  if (done) await finishProductImport(job, after, errors);
  await WpMigrationJob.patch({ templateId: job.templateId, id: job.id })
    .set({ counts, planState: { ...plan, wc: plan.wc }, phase: (done ? "PAGES" : "PRODUCTS") as "PAGES" })
    .go();
  return done ? "PAGES" : "PRODUCTS";
}

async function runPagesStep(job: JobItem, errors: string[]): Promise<string> {
  const pages = await allPages(job.id);
  const pending = pages.filter((p) => p.kind !== "POST" && p.status === "PENDING").slice(0, PAGES_PER_STEP);
  const plan = job.planState as PlanState;
  const knownPosts = await loadKnownPosts(job, pages);
  const counts = { ...emptyCounts(), ...(job.counts as MigrationCounts) };
  const movedLinks = movedLinksFor(job, pages);
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
        appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://plexo.charisol.io",
      });
      if (!row.templateId) throw new Error("This page has no place in the site tree.");
      // Donation forms become native Plexo Donations campaigns (created once per source form).
      let html = result.html;
      // GiveWP forms (classic markup, or a visual-builder form's iframe — fetched, same site only).
      const give = await convertGiveForms(html, async (url) => {
        if (new URL(url, row.sourceUrl).origin !== new URL(plan.origin).origin) return null;
        const res = await migrationFetch(new URL(url, row.sourceUrl).toString(), { headers: { Accept: "text/html" } });
        return res.ok ? res.text() : null;
      });
      html = give.html;
      const donationCampaigns: { campaignId: string; name: string }[] = [];
      for (const form of [...result.donationForms, ...give.forms]) {
        const campaign = await ensureMigratedCampaign(job, form);
        html = html.split(form.token).join(campaign.campaignId);
        donationCampaigns.push(campaign);
      }
      // A WooCommerce store's pages keep the theme with Plexo Commerce's widgets in place
      // of WooCommerce's (shop grid, cart, checkout, order tracking); every page's header
      // cart icon shows Plexo's live cart.
      let storeRole: string | null = null;
      if (plan.wc) {
        if (!plan.wc.storePages) {
          const found = storePagesFromHtml(raw);
          if (found) {
            plan.wc.storePages = found;
            await WpMigrationJob.patch({ templateId: job.templateId, id: job.id }).set({ planState: { ...plan } }).go();
          }
        }
        const role = wcPageRole(raw, row.sourceUrl, plan.wc.storePages ?? null);
        const converted = role && role !== "product" ? convertWcPage(html, role) : null;
        if (converted) {
          html = converted;
          storeRole = role;
        } else if (hasWcChrome(html)) {
          const $wc = cheerio.load(html);
          rewriteWcChrome($wc, plan.wc.storePages?.cart ? pageKeyForUrl(plan.wc.storePages.cart) : undefined);
          html = $wc.html();
        }
      }

      // Post lists ("Latest news", a /blog/ page's grid) show the blog's live posts in the
      // site's own card design instead of a frozen copy — lib/wpMigration/livePostLists.ts.
      let livePostLists = 0;
      let livePostListMax = 0;
      if (knownPosts.length > 0) {
        const $page = cheerio.load(html);
        livePostLists = makePostListsLive($page, knownPosts);
        if (livePostLists > 0) {
          $page('[data-plexo-blog-postlist="true"]').each((_, el) => {
            livePostListMax = Math.max(livePostListMax, Number($page(el).attr("data-plexo-blog-count") ?? 0));
          });
          html = $page.html();
        }
      }
      const role = wpPageRole(raw);
      html = await slimForStorage(html, pathOf(row.sourceUrl, path), inlineFileSaver(job));
      await Template.patch({ id: row.templateId })
        .set({
          compiledHtml: html,
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
          loginForms: result.loginForms,
          donationCampaigns,
          searchForms: result.searchForms,
          internalLinks: result.internalLinks,
          pluginSlugs: Array.from(pluginSlugsFromHtml(raw)),
          assetCount: result.assetPaths.length,
          isPostsIndex: role.isPostsIndex,
          isFront: role.isFront,
          livePostLists,
          livePostListMax,
          ...(storeRole ? { storeRole } : {}),
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
  // Before the files step, so any theme file only the blog's pages use gets copied too.
  if (next === "ASSETS" && !plan.blogPresentationDone) {
    await buildBlogPresentation(job, knownPosts, errors).catch((err) => {
      errors.push(`Your blog keeps Plexo's standard look — we couldn't copy the WordPress blog design: ${err instanceof Error ? err.message : String(err)}`);
    });
    await WpMigrationJob.patch({ templateId: job.templateId, id: job.id }).set({ planState: { ...plan, blogPresentationDone: true } }).go();
  }
  if (next === "ASSETS" && plan.wc && !plan.wc.storeDone) {
    const fresh = (await WpMigrationJob.get({ templateId: job.templateId, id: job.id }).go()).data ?? job;
    await buildStorePresentation(
      fresh,
      await allPages(job.id),
      {
        fetchTransformed: (url, path) => fetchTransformedPage(fresh, url, path, movedLinksFor(fresh, pages)),
        putRedirect: (fromPath, toPath) => putRedirect(job.templateId, fromPath, toPath),
      },
      errors,
    ).catch((err) => {
      errors.push(`Your shop works, but its pages use Plexo's standard design — we couldn't copy the WooCommerce page design: ${err instanceof Error ? err.message : String(err)}`);
    });
    const freshPlan = ((await WpMigrationJob.get({ templateId: job.templateId, id: job.id }).go()).data?.planState as PlanState) ?? plan;
    await WpMigrationJob.patch({ templateId: job.templateId, id: job.id }).set({ planState: { ...freshPlan, wc: { ...(freshPlan.wc ?? plan.wc), storeDone: true } } }).go();
  }
  if (next === "ASSETS") {
    // The blog and store layouts queue their own theme files — count them in the total the
    // owner sees ("305 of 265" otherwise).
    const { data: queued } = await WpMigrationAsset.query.primary({ jobId: job.id }).go({ pages: "all", attributes: ["path"] });
    if (queued.length > counts.assets) {
      counts.assets = queued.length;
      await WpMigrationJob.patch({ templateId: job.templateId, id: job.id }).set({ counts }).go();
    }
  }
  await WpMigrationJob.patch({ templateId: job.templateId, id: job.id }).set({ counts, phase: next as "PAGES" }).go();
  return next;
}

/** Fetches one WordPress page and runs it through the migration's transform (links, forms, donation forms); its files are queued for copying. */
async function fetchTransformedPage(job: JobItem, url: string, path: string, movedLinks: Record<string, string>): Promise<string | null> {
  const plan = job.planState as PlanState;
  const res = await migrationFetch(url, { headers: { Accept: "text/html" } });
  if (!res.ok) return null;
  const raw = await res.text();
  const result = transformPage(raw, {
    origin: plan.origin,
    pageUrl: url,
    pagePath: path,
    pageTitle: "",
    siteTemplateId: job.templateId,
    movedLinks,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://plexo.charisol.io",
  });
  let html = result.html;
  for (const form of result.donationForms) html = html.split(form.token).join((await ensureMigratedCampaign(job, form)).campaignId);
  const limit = pLimit(10);
  await Promise.all(result.assetPaths.map((segs) => limit(() => enqueueAsset(job.id, segs.join("/"), path))));
  // Store layouts are saved as their own records — same size limit as a page.
  return slimForStorage(html, pathOf(url, path), inlineFileSaver(job));
}

/** The site's migrated posts, newest first, in the shape the live-list matcher needs. */
async function loadKnownPosts(job: JobItem, pages: PageItem[]): Promise<KnownPost[]> {
  const rows = pages.filter((p) => p.kind === "POST" && p.status === "DONE" && p.data);
  if (rows.length === 0) return [];
  const { data: categories } = await BlogCategory.query.primary({ templateId: job.templateId }).go({ pages: "all" });
  const slugOf = (name: string) => categories.find((c) => c.name.toLowerCase() === name.toLowerCase())?.slug;
  const strip = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return rows
    .map((row) => {
      const post = row.data as WpPostEntry;
      const path = pageKeyForUrl(post.link);
      return {
        wpId: post.id,
        urls: [post.link, path, `${path}/`, ...(row.newPath ? [row.newPath, `${row.newPath}/`] : [])],
        title: decodeEntities(post.title),
        excerpt: post.excerptHtml ? strip(post.excerptHtml) : null,
        imageStem: imageStem(post.featuredImageUrl),
        dateGmt: post.dateGmt,
        authorName: post.authorName,
        categories: post.categoryNames.flatMap((name) => {
          const slug = slugOf(name);
          return slug ? [{ name, slug }] : [];
        }),
      } satisfies KnownPost;
    })
    .sort((a, b) => (b.dateGmt ?? "").localeCompare(a.dateGmt ?? ""));
}

const BLOG_PAGE_WORDS = /\b(blog|news|insights?|articles?|stories|updates|journal|posts|press)\b/i;

/**
 * Gives the migrated blog the WordPress site's own look and settings (once, at the end of
 * the pages step): its listing layout comes from the site's blog page, its post layout from
 * a real post page, and the blog's name, posts per page, homepage and comments follow how
 * WordPress behaved. Never overrides a layout or setting the owner already set up.
 */
async function buildBlogPresentation(job: JobItem, knownPosts: KnownPost[], errors: string[]): Promise<void> {
  if (knownPosts.length === 0) return;
  const plan = job.planState as PlanState;
  const install = job.install as WpInstall;
  const { data: blogSite } = await BlogSite.get({ templateId: job.templateId }).go();
  if (!blogSite) return;
  const pages = await allPages(job.id);
  const sitePages = pages.filter((p) => p.kind !== "POST" && p.status === "DONE" && p.templateId);
  const front = sitePages.find((p) => p.key === plan.homeKey) ?? sitePages.find((p) => p.isFront);

  // WordPress's Reading settings (exposed publicly on WP 6.x; <body class> on older installs).
  const index = await fetchJson<{ page_for_posts?: number; show_on_front?: string }>(install.restRoot).catch(() => null);
  const postsOnFront = index?.data.show_on_front === "posts" || Boolean(front?.isFront && front.isPostsIndex);
  const pageForPosts = index?.data.page_for_posts ?? 0;

  // Which page is the blog? WordPress's own posts page, a front page showing posts, a page
  // named like a blog that lists posts, or (as a design source only) the biggest post list.
  const named = sitePages
    .filter((p) => (p.livePostLists ?? 0) > 0 && (BLOG_PAGE_WORDS.test(p.key.split("/").pop() ?? "") || BLOG_PAGE_WORDS.test(p.title ?? "")))
    .sort((a, b) => (b.livePostListMax ?? 0) - (a.livePostListMax ?? 0))[0];
  const biggest = sitePages.filter((p) => (p.livePostListMax ?? 0) >= 3).sort((a, b) => (b.livePostListMax ?? 0) - (a.livePostListMax ?? 0))[0];
  const postsPage =
    sitePages.find((p) => pageForPosts > 0 && p.wpId === pageForPosts) ??
    sitePages.find((p) => p.isPostsIndex && !p.isFront) ??
    (postsOnFront ? front : undefined) ??
    named;
  const listingSource = postsPage ?? biggest;

  const loadHtml = async (row: PageItem) => (await Template.get({ id: row.templateId! }).go()).data?.compiledHtml ?? "";
  const frontHtml = front ? await loadHtml(front) : "";

  // ── Listing layout
  let listingHtml: string | null = null;
  let postsPerPage: number | null = null;
  let blogTitle: string | null = null;
  if (listingSource) {
    const listing = listingLayoutFromWpHtml(await loadHtml(listingSource), knownPosts);
    if (listing) {
      listingHtml = listing.html;
      postsPerPage = listing.postsShown;
      blogTitle = listing.title || (postsPage && postsPage !== front ? postsPage.title ?? null : null);
    }
  }
  if (!listingHtml && frontHtml) listingHtml = shellLayout(frontHtml, "listing", blogSite.title ?? "Blog");

  // ── Post layout, from the newest post's own page
  let postHtml: string | null = null;
  let hasComments: boolean | null = null;
  const sample = knownPosts[0];
  const sampleRow = pages.find((p) => p.kind === "POST" && p.wpId === sample.wpId);
  if (sampleRow) {
    try {
      const res = await migrationFetch(sampleRow.sourceUrl, { headers: { Accept: "text/html" } });
      if (res.ok) {
        const raw = await res.text();
        const result = transformPage(raw, {
          origin: plan.origin,
          pageUrl: sampleRow.sourceUrl,
          pagePath: sampleRow.newPath ?? "/blog",
          pageTitle: sample.title,
          siteTemplateId: job.templateId,
          movedLinks: movedLinksFor(job, pages),
          appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://plexo.charisol.io",
        });
        let html = result.html;
        for (const form of result.donationForms) html = html.split(form.token).join((await ensureMigratedCampaign(job, form)).campaignId);
        const layout = postLayoutFromWpHtml(html, sample);
        if (layout) {
          // A sidebar's "Recent posts" stays current too.
          const $post = cheerio.load(layout.html);
          if (makePostListsLive($post, knownPosts) > 0) layout.html = $post.html();
          postHtml = layout.html;
          hasComments = layout.hasComments;
        }
        const limit = pLimit(10);
        await Promise.all(result.assetPaths.map((segs) => limit(() => enqueueAsset(job.id, segs.join("/"), sampleRow.key))));
      }
    } catch (err) {
      errors.push(`We couldn't read a blog post page for the blog design (${err instanceof Error ? err.message : String(err)}) — using the site's header and footer instead.`);
    }
  }
  if (!postHtml && frontHtml) postHtml = shellLayout(frontHtml, "post", blogSite.title ?? "Blog");

  const createLayout = async (name: string, html: string, pagePath: string) => {
    const compiledHtml = await slimForStorage(html, pagePath, inlineFileSaver(job));
    const id = randomUUID();
    await Template.create({
      id,
      userId: job.createdBy,
      organizationId: job.organizationId,
      name,
      kind: "LANDING_PAGE",
      sourceType: "RAW_UPLOAD",
      isBlogLayout: true,
      designJson: {},
      compiledHtml,
      migratedFrom: plan.origin,
    }).go();
    return id;
  };
  const changes: Record<string, unknown> = {};
  if (listingHtml && !blogSite.listingLayoutTemplateId) changes.listingLayoutTemplateId = await createLayout("Blog listing (from WordPress)", listingHtml, "/blog/");
  if (postHtml && !blogSite.postLayoutTemplateId) changes.postLayoutTemplateId = await createLayout("Blog post (from WordPress)", postHtml, "/blog/post/");
  if (blogTitle && (!blogSite.title || blogSite.title === "Blog")) changes.title = blogTitle.slice(0, 120);
  if (postsPerPage && postsPerPage >= 1 && postsPerPage <= 50 && (blogSite.postsPerPage ?? 10) === 10) changes.postsPerPage = postsPerPage;
  if (hasComments !== null) changes.commentsEnabled = hasComments;
  // "Your homepage displays: latest posts" — the domain root serves the live blog.
  if (postsOnFront && plan.homeKey === "/") changes.showOnHomepage = true;
  if (Object.keys(changes).length > 0) await BlogSite.patch({ templateId: job.templateId }).set(changes).go();

  // The old posts page's job is now /blog's (with every post, paginated) — send its URL there
  // permanently. Never the front page, and never a page only borrowed for its design.
  if (postsPage && postsPage !== front && postsPage.templateId && pageKeyForUrl(postsPage.sourceUrl) !== "/blog") {
    await Template.patch({ id: postsPage.templateId }).set({ redirectTo: "/blog" }).go();
  }
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
      // A product's page is served by Plexo Commerce at the same URL (CommerceSettings.productUrlBase).
      if (plan.wc?.productBase && key.startsWith(`${plan.wc.productBase}/`)) continue;
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
    customApis: { frozen: plan.frozenApis ?? [], captured: plan.capturedApis ?? [] },
    paymentsReady: await donationPaymentsReady(job.templateId),
    ...(plan.wc
      ? {
          store: {
            productBase: plan.wc.productBase,
            skipped: plan.wc.skipped,
            expandedStock: plan.wc.expandedStock,
            reviewsImported: (plan.wc as { reviewsImported?: number }).reviewsImported,
          },
        }
      : {}),
  });

  await Template.patch({ id: job.templateId }).set({ migratedFrom: plan.origin }).go();
  await WpMigrationJob.patch({ templateId: job.templateId, id: job.id })
    .set({ plugins, report, phase: "COMPLETED", finishedAt: new Date().toISOString() })
    .go();
  await notifyMigrationDone(job, report);
  return "COMPLETED";
}

/** The most recent payment-setup problem a real donation hit on this site, if any (see donations.ts). */
export async function donationPaymentIssue(templateId: string): Promise<string | null> {
  const { data } = await CommerceDonationCampaign.query.primary({ templateId }).go({ pages: "all" });
  return data.find((c) => c.paymentIssue)?.paymentIssue ?? null;
}

/** Whether the migrated site can take card payments now (monthly giving needs a card gateway). */
export async function donationPaymentsReady(templateId: string): Promise<boolean> {
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  return resolveDonationGateway(settings).gatewayReady;
}

/**
 * Processes exactly one bounded step of a migration and returns the resulting phase —
 * same atomic-claim contract as lib/siteImport/runJobDynamo.ts's processSiteImportStep.
 */
/** `busy`: another driver (the open dashboard, or the background) is running a step right now. */
export async function processWpMigrationStep(templateId: string, jobId: string, revalidate: RevalidateFn = NOOP_REVALIDATE): Promise<{ done: boolean; phase: string; busy?: boolean }> {
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
      return { done: false, phase: current?.phase ?? "CANCELLED", busy: true };
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
      next = await runPlanning(job, warnings);
    } else if (phase === "POSTS") {
      next = await runPostsStep(job, errors, revalidate);
    } else if (phase === "PRODUCTS") {
      next = await runProductsStep(job, errors);
    } else if (phase === "PAGES") {
      next = await runPagesStep(job, errors);
    } else if (phase === "ASSETS") {
      next = await runAssetsStep(job);
    } else if (phase === "FINALIZING") {
      next = await runFinalizing(job);
    } else {
      next = phase;
    }
    await WpMigrationJob.patch({ templateId, id: jobId })
      .set({ processing: false, lastHeartbeatAt: new Date().toISOString(), errors: errors.slice(-200), ...(job.transientRetries ? { transientRetries: 0 } : {}) })
      .go();
    return { done: TERMINAL.has(next), phase: next };
  } catch (err) {
    // A throttle or blip: every step is safe to re-run, so try again (after a short
    // back-off) instead of stopping the owner's migration on something that isn't theirs.
    const retries = job.transientRetries ?? 0;
    if (isTransientAwsError(err) && retries < MAX_TRANSIENT_RETRIES) {
      await new Promise((r) => setTimeout(r, 2000 * (retries + 1)));
      await WpMigrationJob.patch({ templateId, id: jobId }).set({ processing: false, lastHeartbeatAt: new Date().toISOString(), transientRetries: retries + 1 }).go();
      return { done: false, phase };
    }
    const reason = stepErrorMessage(phase, err);
    errors.push(reason);
    // An owner who closed the tab would otherwise never know it's waiting on them.
    const emailPause = !job.pauseEmailedAt || Date.now() - Date.parse(job.pauseEmailedAt) > PAUSE_EMAIL_EVERY_MS;
    await WpMigrationJob.patch({ templateId, id: jobId })
      .set({
        phase: "PAUSED_ERROR",
        processing: false,
        transientRetries: 0,
        ...(emailPause ? { pauseEmailedAt: new Date().toISOString() } : {}),
        errors: errors.slice(-200),
        lastHeartbeatAt: new Date().toISOString(),
        planState: { ...((job.planState as object | undefined) ?? {}), pausedIn: phase === "PENDING" ? "PLANNING" : phase },
      })
      .go();
    if (emailPause) await notifyMigrationPaused(job, (job.planState as PlanState | undefined)?.siteName ?? "", reason);
    return { done: false, phase: "PAUSED_ERROR" };
  }
}

