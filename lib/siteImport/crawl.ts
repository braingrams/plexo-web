import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import pLimit from "p-limit";
import { safeFetch, SsrfBlockedError } from "./fetchSafe";
import type { DiscoveredUrl } from "./types";

const NON_CONTENT_EXTENSIONS = new Set([
  "pdf", "zip", "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico",
  "css", "js", "mjs", "json", "xml", "woff", "woff2", "ttf", "otf", "eot", "mp4", "mp3",
]);
const NON_CONTENT_PATH_SEGMENTS = ["/wp-admin", "/wp-login", "/cart", "/checkout", "/account", "/admin"];
const CONCURRENCY_PER_DOMAIN = 3;
const MIN_REQUEST_SPACING_MS = 250;
const MAX_RETRIES = 3;

/** Strips fragment/trailing-slash/common tracking params so the same page isn't discovered twice under different URLs. */
export function normalizeDiscoveredUrl(raw: string, base: string): string | null {
  try {
    const u = new URL(raw, base);
    u.hash = "";
    for (const param of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"]) {
      u.searchParams.delete(param);
    }
    u.pathname = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : u.pathname;
    return u.toString();
  } catch {
    return null;
  }
}

function isSameOrigin(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

function looksLikeContentPage(url: string): boolean {
  const path = new URL(url).pathname.toLowerCase();
  const ext = path.split(".").pop();
  if (ext && NON_CONTENT_EXTENSIONS.has(ext) && path.includes(".")) return false;
  return !NON_CONTENT_PATH_SEGMENTS.some((seg) => path.startsWith(seg));
}

/** A small token-bucket-ish limiter: bounded concurrency plus a minimum gap between requests to the same host, with backoff on 429/503. */
class DomainRateLimiter {
  private readonly limit = pLimit(CONCURRENCY_PER_DOMAIN);
  private lastRequestAt = 0;

  async fetch(url: string): Promise<Response | null> {
    return this.limit(async () => {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const wait = MIN_REQUEST_SPACING_MS - (Date.now() - this.lastRequestAt);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        this.lastRequestAt = Date.now();

        try {
          const res = await safeFetch(url, { headers: { Accept: "text/html,application/xml,application/rss+xml,*/*" } });
          if (res.status === 429 || res.status === 503) {
            const retryAfter = Number.parseInt(res.headers.get("retry-after") || "", 10);
            const backoffMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 2 ** attempt * 2000;
            if (attempt < MAX_RETRIES) {
              await new Promise((r) => setTimeout(r, backoffMs));
              continue;
            }
          }
          return res;
        } catch (err) {
          if (err instanceof SsrfBlockedError) throw err; // never retry a blocked target
          if (attempt >= MAX_RETRIES) return null;
          await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
        }
      }
      return null;
    });
  }
}

interface RobotsResult {
  disallowedPaths: string[];
  sitemaps: string[];
}

async function fetchRobotsTxt(baseUrl: string, limiter: DomainRateLimiter): Promise<RobotsResult> {
  const result: RobotsResult = { disallowedPaths: [], sitemaps: [] };
  const res = await limiter.fetch(new URL("/robots.txt", baseUrl).toString());
  if (!res || !res.ok) return result;
  const text = await res.text();

  let applicable = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") applicable = value === "*" || /plexo/i.test(value);
    else if (key === "disallow" && applicable && value) result.disallowedPaths.push(value);
    else if (key === "sitemap" && value) result.sitemaps.push(value);
  }
  return result;
}

function isDisallowed(url: string, disallowedPaths: string[]): boolean {
  const path = new URL(url).pathname;
  return disallowedPaths.some((rule) => path.startsWith(rule));
}

interface SitemapUrlEntry { loc?: string }
interface SitemapUrlset { url?: SitemapUrlEntry | SitemapUrlEntry[] }
interface SitemapIndexEntry { loc?: string }
interface SitemapIndex { sitemapindex?: { sitemap?: SitemapIndexEntry | SitemapIndexEntry[] }; urlset?: SitemapUrlset }

const xmlParser = new XMLParser({ ignoreAttributes: true });

async function fetchSitemapUrls(sitemapUrl: string, limiter: DomainRateLimiter, depth = 0): Promise<string[]> {
  if (depth > 1) return []; // one level of <sitemapindex> nesting only
  const res = await limiter.fetch(sitemapUrl);
  if (!res || !res.ok) return [];
  let parsed: SitemapIndex;
  try {
    parsed = xmlParser.parse(await res.text()) as SitemapIndex;
  } catch {
    return [];
  }

  if (parsed.sitemapindex?.sitemap) {
    const entries = Array.isArray(parsed.sitemapindex.sitemap) ? parsed.sitemapindex.sitemap : [parsed.sitemapindex.sitemap];
    const nested = await Promise.all(entries.filter((e) => e.loc).map((e) => fetchSitemapUrls(e.loc as string, limiter, depth + 1)));
    return nested.flat();
  }
  if (parsed.urlset?.url) {
    const entries = Array.isArray(parsed.urlset.url) ? parsed.urlset.url : [parsed.urlset.url];
    return entries.map((e) => e.loc).filter((loc): loc is string => Boolean(loc));
  }
  return [];
}

async function discoverFeedUrls(baseUrl: string, homepageHtml: string, limiter: DomainRateLimiter): Promise<string[]> {
  const $ = cheerio.load(homepageHtml);
  const feedLinks = new Set<string>();
  $('link[rel="alternate"][type="application/rss+xml"], link[rel="alternate"][type="application/atom+xml"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      const normalized = normalizeDiscoveredUrl(href, baseUrl);
      if (normalized) feedLinks.add(normalized);
    }
  });
  if (feedLinks.size === 0) {
    for (const path of ["/feed", "/feed.xml", "/blog/rss.xml", "/blog/feed", "/blog-feed.xml"]) {
      feedLinks.add(new URL(path, baseUrl).toString());
    }
  }

  const postUrls = new Set<string>();
  await Promise.all(
    Array.from(feedLinks).map(async (feedUrl) => {
      const res = await limiter.fetch(feedUrl);
      if (!res || !res.ok) return;
      let parsed: { rss?: { channel?: { item?: unknown } }; feed?: { entry?: unknown } };
      try {
        parsed = xmlParser.parse(await res.text());
      } catch {
        return;
      }
      const rssItems = parsed.rss?.channel?.item;
      const atomEntries = parsed.feed?.entry;
      const items = Array.isArray(rssItems) ? rssItems : rssItems ? [rssItems] : Array.isArray(atomEntries) ? atomEntries : atomEntries ? [atomEntries] : [];
      for (const item of items as Record<string, unknown>[]) {
        const link = typeof item.link === "string" ? item.link : (item.link as { "#text"?: string; "@_href"?: string })?.["#text"] || (item.link as { "@_href"?: string })?.["@_href"];
        if (typeof link === "string") {
          const normalized = normalizeDiscoveredUrl(link, baseUrl);
          if (normalized) postUrls.add(normalized);
        }
      }
    }),
  );
  return Array.from(postUrls);
}

async function crawlLinksFromHomepage(baseUrl: string, homepageHtml: string, limiter: DomainRateLimiter, maxPages: number): Promise<string[]> {
  const visited = new Set<string>();
  const queue: string[] = [];
  const seed = normalizeDiscoveredUrl(baseUrl, baseUrl);
  if (seed) queue.push(seed);

  const extractLinks = (html: string, pageUrl: string): string[] => {
    const $ = cheerio.load(html);
    const links: string[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const normalized = normalizeDiscoveredUrl(href, pageUrl);
      if (normalized && isSameOrigin(normalized, baseUrl) && looksLikeContentPage(normalized)) links.push(normalized);
    });
    return links;
  };

  if (seed) visited.add(seed);
  let html = homepageHtml;
  let frontier = [seed].filter((u): u is string => Boolean(u));

  while (frontier.length > 0 && visited.size < maxPages) {
    const next: string[] = [];
    for (const pageUrl of frontier) {
      const pageHtml = pageUrl === seed ? html : await (async () => {
        const res = await limiter.fetch(pageUrl);
        return res && res.ok ? res.text() : null;
      })();
      if (!pageHtml) continue;
      for (const link of extractLinks(pageHtml, pageUrl)) {
        if (!visited.has(link) && visited.size < maxPages) {
          visited.add(link);
          next.push(link);
        }
      }
    }
    frontier = next;
  }
  return Array.from(visited);
}

export interface DiscoverSiteOptions {
  maxPages: number;
}

export interface DiscoverSiteResult {
  discovered: DiscoveredUrl[];
  excluded: { url: string; reason: string }[];
}

/**
 * Layered URL discovery: robots.txt (also yields Disallow rules + declared sitemaps) ->
 * sitemap.xml (primary source) -> RSS/Atom feed autodiscovery (blog-post classification
 * signal, works across all four platforms) -> homepage link-crawl (fallback only, when
 * sitemap.xml comes up thin). Every URL is deduped by normalizeDiscoveredUrl. Nothing found
 * is ever silently dropped for being out of scope — capped/robots-blocked URLs land in
 * `excluded` with a reason, for an honest final report.
 */
export async function discoverSite(baseUrl: string, homepageHtml: string, opts: DiscoverSiteOptions): Promise<DiscoverSiteResult> {
  const limiter = new DomainRateLimiter();
  const robots = await fetchRobotsTxt(baseUrl, limiter);

  const sitemapCandidates = robots.sitemaps.length > 0
    ? robots.sitemaps
    : [new URL("/sitemap.xml", baseUrl).toString(), new URL("/sitemap_index.xml", baseUrl).toString()];

  const sitemapUrlLists = await Promise.all(sitemapCandidates.map((s) => fetchSitemapUrls(s, limiter)));
  const sitemapUrls = Array.from(new Set(sitemapUrlLists.flat().map((u) => normalizeDiscoveredUrl(u, baseUrl)).filter((u): u is string => Boolean(u))));

  const feedUrls = new Set(await discoverFeedUrls(baseUrl, homepageHtml, limiter));

  let allUrls = sitemapUrls;
  if (allUrls.length < 3) {
    const crawled = await crawlLinksFromHomepage(baseUrl, homepageHtml, limiter, opts.maxPages);
    allUrls = Array.from(new Set([...allUrls, ...crawled]));
  }
  // Feed-only URLs (post published but never listed in the sitemap) still count.
  allUrls = Array.from(new Set([...allUrls, ...feedUrls]));
  if (!allUrls.includes(normalizeDiscoveredUrl(baseUrl, baseUrl) ?? baseUrl)) {
    const home = normalizeDiscoveredUrl(baseUrl, baseUrl);
    if (home) allUrls.unshift(home);
  }

  const discovered: DiscoveredUrl[] = [];
  const excluded: { url: string; reason: string }[] = [];

  for (const url of allUrls) {
    if (!isSameOrigin(url, baseUrl)) continue;
    if (isDisallowed(url, robots.disallowedPaths)) {
      excluded.push({ url, reason: "excluded per robots.txt" });
      continue;
    }
    if (discovered.length >= opts.maxPages) {
      excluded.push({ url, reason: "page cap reached" });
      continue;
    }
    discovered.push({
      url,
      likelyBlogPost: feedUrls.has(url) || /\/(blog|news|articles|posts)\//i.test(url) || /\/\d{4}\/\d{2}\//.test(url),
      source: feedUrls.has(url) ? "feed" : sitemapUrls.includes(url) ? "sitemap" : "link-crawl",
    });
  }

  return { discovered, excluded };
}
