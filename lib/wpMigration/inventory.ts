import type { WpInstall, WpInventory, WpMediaEntry, WpPageEntry, WpPostEntry, WpPostStub, WpSeo, WpTermEntry } from "./types";
import { fetchJson, migrationFetch, restUrl } from "./http";
import { buildPluginReport, pluginSlugsFromHtml, themeSlugsFromHtml } from "./pluginCatalog";
import * as cheerio from "cheerio";
import pLimit from "p-limit";

// Everything here reads only what WordPress already publishes to anonymous visitors via
// its REST API — the same data any visitor's browser could fetch. Drafts, private pages,
// form definitions and plugin settings need the Plexo Migrator companion plugin (a later
// phase); this inventory is complete for everything a visitor can actually see.

const PER_PAGE = 100;
// A real bound, not "until done" — it stops a misbehaving API (X-WP-TotalPages lying)
// from looping forever — but far past any real site: 2,000 × 100 = 200,000 items.
const MAX_API_PAGES = 2000;

type Rendered = { rendered?: string };

interface YoastHeadJson {
  title?: string;
  description?: string;
  canonical?: string;
  robots?: { index?: string; follow?: string };
  og_image?: { url?: string }[];
}

interface RawPage {
  id: number;
  link: string;
  title?: Rendered;
  parent?: number;
  menu_order?: number;
  modified_gmt?: string;
  yoast_head_json?: YoastHeadJson;
}

interface RawPost extends RawPage {
  slug: string;
  date_gmt?: string;
  content?: Rendered;
  excerpt?: Rendered;
  _embedded?: {
    author?: { name?: string; avatar_urls?: Record<string, string>; code?: string }[];
    "wp:featuredmedia"?: { source_url?: string; alt_text?: string; code?: string }[];
    "wp:term"?: { taxonomy: string; name: string }[][];
  };
}

interface RawTerm {
  slug: string;
  name: string;
  link: string;
}

interface RawMedia {
  id: number;
  source_url: string;
  mime_type: string;
  link?: string;
}

/** Decodes the HTML entities WordPress leaves in rendered titles ("Pop &#8211; The Balloon"). */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function seoFrom(raw: YoastHeadJson | undefined): WpSeo {
  return {
    title: raw?.title ? decodeEntities(raw.title) : null,
    description: raw?.description ? decodeEntities(raw.description) : null,
    canonical: raw?.canonical ?? null,
    robots: raw?.robots ?? null,
    ogImage: raw?.og_image?.[0]?.url ?? null,
  };
}

async function fetchAll<T>(restRoot: string, route: string, params: Record<string, string | number> = {}): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= MAX_API_PAGES; page++) {
    const res = await fetchJson<T[]>(restUrl(restRoot, route, { per_page: PER_PAGE, page, ...params }));
    // WordPress 400s past the last page — a normal "done", same as an empty page.
    if (!res || !Array.isArray(res.data) || res.data.length === 0) break;
    items.push(...res.data);
    const totalPages = Number.parseInt(res.headers.get("x-wp-totalpages") || "1", 10);
    if (page >= totalPages) break;
  }
  return items;
}

function mapPost(p: RawPost): WpPostEntry {
  const embedded = p._embedded ?? {};
  const author = embedded.author?.[0];
  const media = embedded["wp:featuredmedia"]?.[0];
  const terms = (embedded["wp:term"] ?? []).flat();
  return {
    id: p.id,
    link: p.link,
    slug: decodeURIComponent(p.slug),
    title: decodeEntities(p.title?.rendered ?? ""),
    contentHtml: p.content?.rendered ?? "",
    excerptHtml: p.excerpt?.rendered ?? "",
    dateGmt: p.date_gmt ? `${p.date_gmt}Z` : null,
    modifiedGmt: p.modified_gmt ? `${p.modified_gmt}Z` : null,
    authorName: author && !author.code ? author.name ?? null : null,
    authorAvatarUrl: author && !author.code ? author.avatar_urls?.["96"] ?? null : null,
    categoryNames: terms.filter((t) => t.taxonomy === "category").map((t) => decodeEntities(t.name)),
    tagNames: terms.filter((t) => t.taxonomy === "post_tag").map((t) => decodeEntities(t.name)),
    featuredImageUrl: media && !media.code ? media.source_url ?? null : null,
    featuredImageAlt: media && !media.code ? media.alt_text ?? null : null,
    seo: seoFrom(p.yoast_head_json),
  };
}

/** One page (100 items) of a WordPress list, and how many pages there are in all. */
export interface ApiPage<T> {
  items: T[];
  totalPages: number;
}

async function fetchApiPage<T>(restRoot: string, route: string, page: number, params: Record<string, string | number>): Promise<ApiPage<T>> {
  const res = await fetchJson<T[]>(restUrl(restRoot, route, { per_page: PER_PAGE, page, ...params }));
  // WordPress 400s past the last page — a normal "done", same as an empty page.
  if (!res || !Array.isArray(res.data)) return { items: [], totalPages: 0 };
  return { items: res.data, totalPages: Number.parseInt(res.headers.get("x-wp-totalpages") || "1", 10) || 1 };
}

/** One page of the post index — just enough to place and link each post (not its content). */
export async function fetchPostIndexPage(restRoot: string, page: number): Promise<ApiPage<WpPostStub>> {
  const res = await fetchApiPage<RawPost>(restRoot, "wp/v2/posts", page, { _fields: "id,link,slug,title", orderby: "id", order: "asc" });
  return {
    totalPages: res.totalPages,
    items: res.items.map((p) => ({ id: p.id, link: p.link, slug: decodeURIComponent(p.slug), title: decodeEntities(p.title?.rendered ?? "") })),
  };
}

/** The full posts (content, author, featured image, terms, SEO) for these ids — at most 100. */
export async function fetchPostsByIds(restRoot: string, ids: number[]): Promise<WpPostEntry[]> {
  if (ids.length === 0) return [];
  const res = await fetchJson<RawPost[]>(restUrl(restRoot, "wp/v2/posts", { include: ids.join(","), per_page: ids.length, _embed: 1 }));
  if (!res || !Array.isArray(res.data)) throw new Error("WordPress didn't return these posts.");
  return res.data.map(mapPost);
}

/** How long one post's own page may take to load for its SEO tags before we go without them. */
const SEO_PAGE_TIMEOUT_MS = 12_000;

/**
 * Only Yoast puts its SEO tags in the API. With Rank Math, All in One SEO, SEOPress or none,
 * the post's own published page is the source of truth — read the tags from it. Done per post
 * as that post is copied (not for a whole batch up front): on a slow site each page can take
 * several seconds, and 40 of them in a row outlasted the step's time limit before a single
 * post was saved — the migration then retried the same batch forever.
 */
export async function fillSeoFromPage(post: WpPostEntry): Promise<void> {
  if (post.seo.title || post.seo.description) return;
  const page = await migrationFetch(post.link, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(SEO_PAGE_TIMEOUT_MS) }).catch(() => null);
  if (!page?.ok) return;
  const html = await page.text().catch(() => null);
  if (html) post.seo = seoFromHtml(html);
}

/** A page's SEO tags, whichever plugin wrote them. */
export function seoFromHtml(html: string): WpSeo {
  const $ = cheerio.load(html);
  const meta = (selector: string) => $(selector).first().attr("content")?.trim() || null;
  const robots = meta('meta[name="robots"]');
  return {
    title: $("head > title").first().text().trim() || null,
    description: meta('meta[name="description"]'),
    canonical: $('link[rel="canonical"]').first().attr("href")?.trim() || null,
    robots: robots ? { index: /noindex/i.test(robots) ? "noindex" : "index", follow: /nofollow/i.test(robots) ? "nofollow" : "follow" } : null,
    ogImage: meta('meta[property="og:image"]'),
  };
}

export async function fetchTermsPage(restRoot: string, taxonomy: "category" | "post_tag", page: number): Promise<ApiPage<WpTermEntry>> {
  const res = await fetchApiPage<RawTerm>(restRoot, taxonomy === "category" ? "wp/v2/categories" : "wp/v2/tags", page, { _fields: "slug,name,link", hide_empty: "true" });
  return { totalPages: res.totalPages, items: res.items.map((t) => ({ taxonomy, slug: decodeURIComponent(t.slug), name: decodeEntities(t.name), link: t.link })) };
}

export async function fetchMediaPage(restRoot: string, page: number): Promise<ApiPage<WpMediaEntry>> {
  const res = await fetchApiPage<RawMedia>(restRoot, "wp/v2/media", page, { _fields: "id,source_url,mime_type,link", orderby: "id", order: "asc" });
  return { totalPages: res.totalPages, items: res.items.map((m) => ({ id: m.id, sourceUrl: m.source_url, mimeType: m.mime_type, link: m.link ?? null })) };
}

/** Reads the site-wide public inventory of a discovered WordPress install (posts, terms and media are listed separately, page by page). */
export async function buildInventory(install: WpInstall): Promise<WpInventory> {
  const { restRoot } = install;
  const [rawPages, homeHtml] = await Promise.all([
    fetchAll<RawPage>(restRoot, "wp/v2/pages", { _fields: "id,link,title,parent,menu_order,modified_gmt,yoast_head_json" }),
    migrationFetch(`${install.homeUrl}/`, { headers: { Accept: "text/html" } })
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => ""),
  ]);

  const pages: WpPageEntry[] = rawPages.map((p) => ({
    id: p.id,
    link: p.link,
    title: decodeEntities(p.title?.rendered ?? ""),
    parent: p.parent ?? 0,
    menuOrder: p.menu_order ?? 0,
    modifiedGmt: p.modified_gmt ? `${p.modified_gmt}Z` : null,
    seo: seoFrom(p.yoast_head_json),
  }));

  const homeKey = install.homeUrl.replace(/\/+$/, "");
  const frontPage = pages.find((p) => p.link.replace(/\/+$/, "") === homeKey);

  const themeSlugs = themeSlugsFromHtml(homeHtml);
  return {
    install,
    pages,
    plugins: buildPluginReport(install.namespaces, pluginSlugsFromHtml(homeHtml)),
    // Child theme assets load after the parent's, but either order is fine for the report —
    // a two-theme hit is reported as child-of-parent, which is the WordPress convention.
    theme: themeSlugs.length === 0 ? null : { slug: themeSlugs.find((s) => s.endsWith("-child")) ?? themeSlugs[0], parentSlug: themeSlugs.length > 1 ? themeSlugs.find((s) => !s.endsWith("-child")) ?? null : null },
    frontPageId: frontPage?.id ?? null,
  };
}

export interface MigrationPreview {
  siteName: string;
  siteDescription: string;
  origin: string;
  homeUrl: string;
  /** WordPress lives in a subfolder (e.g. /lineagecare) rather than at the domain root. */
  inSubdirectory: boolean;
  staticPages: string[];
  counts: { pages: number; posts: number; media: number; categories: number; tags: number };
  theme: { slug: string; parentSlug: string | null } | null;
  plugins: ReturnType<typeof buildPluginReport>;
}

async function countOf(restRoot: string, route: string): Promise<number> {
  const res = await fetchJson<unknown[]>(restUrl(restRoot, route, { per_page: 1, _fields: "id" }));
  return res ? Number.parseInt(res.headers.get("x-wp-total") || "0", 10) || (Array.isArray(res.data) ? res.data.length : 0) : 0;
}

/** What a migration would move — totals only, fast enough to show before the owner commits. */
export async function previewInstall(install: WpInstall): Promise<MigrationPreview> {
  const [pages, posts, media, categories, tags, homeHtml] = await Promise.all([
    countOf(install.restRoot, "wp/v2/pages"),
    countOf(install.restRoot, "wp/v2/posts"),
    countOf(install.restRoot, "wp/v2/media"),
    countOf(install.restRoot, "wp/v2/categories"),
    countOf(install.restRoot, "wp/v2/tags"),
    migrationFetch(`${install.homeUrl}/`, { headers: { Accept: "text/html" } })
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => ""),
  ]);
  const themeSlugs = themeSlugsFromHtml(homeHtml);
  return {
    siteName: install.siteName,
    siteDescription: install.siteDescription,
    origin: install.origin,
    homeUrl: install.homeUrl,
    inSubdirectory: install.homeUrl.replace(/\/+$/, "") !== install.origin,
    staticPages: install.staticPages,
    counts: { pages: pages + install.staticPages.length, posts, media, categories, tags },
    theme: themeSlugs.length === 0 ? null : { slug: themeSlugs.find((s) => s.endsWith("-child")) ?? themeSlugs[0], parentSlug: themeSlugs.length > 1 ? themeSlugs.find((s) => !s.endsWith("-child")) ?? null : null },
    plugins: buildPluginReport(install.namespaces, pluginSlugsFromHtml(homeHtml)),
  };
}
