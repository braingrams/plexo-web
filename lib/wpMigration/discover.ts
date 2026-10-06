import * as cheerio from "cheerio";
import { normalizeSiteUrl } from "@/lib/blogImport/wpClient";
import type { WpInstall } from "./types";
import { fetchJson, migrationFetch } from "./http";

// Real WordPress sites rarely sit cleanly at "https://domain/" with /wp-json/ beside it.
// The case this was built against (lineagecarefoundation.org) is typical of the hard end:
// a hand-written splash page at "/" that JS-redirects to a hand-written "/gateway" chooser
// page, which links into a WordPress install living in "/lineagecare/" — and the server
// answers every unknown path (including "/wp-json/") with the splash page's HTML and a 200.
// Probing "/wp-json/" alone finds nothing; the generic site importer would scrape the 2KB
// splash page and stop. So discovery walks the site the way a visitor would — following
// meta-refresh and JS redirects and same-origin links — until it finds WordPress's own
// REST-discovery <link>, and remembers every non-WordPress page it passed on the way.

const MAX_DISCOVERY_FETCHES = 12;
const MAX_DEPTH = 3;

interface RestIndex {
  name?: string;
  description?: string;
  url?: string;
  home?: string;
  namespaces?: string[];
}

export class WordPressNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WordPressNotFoundError";
  }
}

/** Redirect targets a page sends a visitor to without a click: meta refresh, and the common inline-JS location assignments. */
export function extractAutoRedirects(html: string, pageUrl: string): string[] {
  const targets: string[] = [];
  const $ = cheerio.load(html);
  const refresh = $('meta[http-equiv="refresh" i]').attr("content");
  const refreshMatch = refresh?.match(/url\s*=\s*['"]?([^'";]+)/i);
  if (refreshMatch) targets.push(refreshMatch[1].trim());
  $("script:not([src])").each((_, el) => {
    const code = $(el).text();
    const re = /(?:window\.|document\.|top\.|self\.)?location(?:\.href)?\s*=\s*["'`]([^"'`]+)["'`]|location\.(?:replace|assign)\(\s*["'`]([^"'`]+)["'`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) targets.push((m[1] ?? m[2]).trim());
  });
  return targets
    .map((t) => {
      try {
        return new URL(t, pageUrl).toString();
      } catch {
        return null;
      }
    })
    .filter((u): u is string => Boolean(u));
}

/** WordPress core prints <link rel="https://api.w.org/" href=".../wp-json/"> on every front-end page regardless of theme. */
function findRestLink(html: string, pageUrl: string): string | null {
  const $ = cheerio.load(html);
  const href = $('link[rel="https://api.w.org/"]').attr("href");
  if (!href) return null;
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return null;
  }
}

/** A theme that strips the REST <link> still serves its assets from wp-content — the path before it is the install root. */
function inferInstallFromAssetPaths(html: string, origin: string): string | null {
  const re = /(https?:)?\/\/([^/"'\s]+)(\/[^"'\s]*?)?\/wp-(?:content|includes)\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const candidate = `${m[1] ?? "https:"}//${m[2]}${m[3] ?? ""}`;
    try {
      if (new URL(candidate).origin === origin) return candidate.replace(/\/+$/, "");
    } catch {
      // keep scanning
    }
  }
  return null;
}

function sameOriginLinks(html: string, pageUrl: string, origin: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) return;
    try {
      const u = new URL(href, pageUrl);
      u.hash = "";
      if (u.origin === origin) links.add(u.toString());
    } catch {
      // ignore
    }
  });
  return Array.from(links);
}

async function readRestIndex(restRoot: string): Promise<RestIndex | null> {
  const res = await fetchJson<RestIndex>(restRoot);
  if (!res || !Array.isArray(res.data.namespaces)) return null;
  return res.data;
}

function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/**
 * Locates the WordPress install behind any URL the owner gives us — their domain root,
 * a deep link, or a subdirectory install's own URL — and returns its REST root plus any
 * non-WordPress pages in front of it. Throws WordPressNotFoundError with an
 * owner-readable message when there's genuinely no WordPress to find.
 */
export async function discoverWordPressInstall(inputUrl: string): Promise<WpInstall> {
  const start = normalizeSiteUrl(inputUrl);
  const origin = new URL(start).origin;

  // Fast path: the conventional location answers with a real REST index.
  const conventional = await readRestIndex(`${origin}/wp-json/`);

  const visited = new Set<string>();
  const nonWpPages: string[] = [];
  let restRoot: string | null = conventional ? `${origin}/wp-json/` : null;
  let index: RestIndex | null = conventional;

  const queue: { url: string; depth: number }[] = [{ url: start, depth: 0 }];
  if (start !== `${origin}/`) queue.push({ url: `${origin}/`, depth: 0 });

  let fetches = 0;
  while (queue.length > 0 && fetches < MAX_DISCOVERY_FETCHES) {
    const { url, depth } = queue.shift()!;
    const key = url.replace(/\/+$/, "");
    if (visited.has(key)) continue;
    visited.add(key);
    // Once WordPress is known, only keep walking pages outside it — we're now just
    // collecting the static pages that sit in front of the install.
    const knownHome = index ? (index.home ?? index.url ?? origin).replace(/\/+$/, "") : null;
    if (knownHome && (key === knownHome || key.startsWith(`${knownHome}/`))) continue;

    let html: string;
    let finalUrl = url;
    try {
      const res = await migrationFetch(url, { headers: { Accept: "text/html" } });
      fetches += 1;
      if (!res.ok || !(res.headers.get("content-type") || "").includes("html")) continue;
      html = await res.text();
      finalUrl = res.url || url;
    } catch {
      continue;
    }

    const restLink = findRestLink(html, finalUrl);
    const inferred = restLink ? null : inferInstallFromAssetPaths(html, origin);
    const candidateRoot = restLink ?? (inferred ? `${inferred}/wp-json/` : null);

    if (candidateRoot && !index) {
      const found = await readRestIndex(candidateRoot);
      if (found) {
        index = found;
        restRoot = candidateRoot;
      }
    }

    if (!restLink && !inferred) {
      // A page with no trace of WordPress on it — part of the site, served by something else.
      nonWpPages.push(key === origin ? `${origin}/` : key);
    }

    if (depth >= MAX_DEPTH) continue;
    for (const target of extractAutoRedirects(html, finalUrl)) {
      if (new URL(target).origin === origin) queue.unshift({ url: target, depth: depth + 1 });
    }
    // Only walk outward from pages that aren't WordPress — inside the install the REST
    // API is the authoritative inventory, so crawling its links would just duplicate it.
    if (!restLink && !inferred) {
      for (const link of sameOriginLinks(html, finalUrl, origin)) queue.push({ url: link, depth: depth + 1 });
    }
  }

  if (!index || !restRoot) {
    throw new WordPressNotFoundError(
      "We couldn't find a WordPress site at that address. Check the URL is the site visitors see " +
        "(not the wp-admin login page), and that the site isn't in maintenance mode or behind a password.",
    );
  }

  const homeUrl = (index.home ?? index.url ?? origin).replace(/\/+$/, "");
  const homeKey = homeUrl;
  // A non-WordPress page under the install's own path (rare: a static file WordPress
  // itself doesn't generate) is still outside WP's inventory — but anything we classified
  // as non-WP that is actually the WP home (a theme that strips every WP signature) isn't.
  const staticPages = nonWpPages.filter((p) => p.replace(/\/+$/, "") !== homeKey);

  return {
    origin,
    homeUrl,
    restRoot: restRoot.includes("rest_route=") ? restRoot : withTrailingSlash(restRoot),
    siteName: index.name ?? "",
    siteDescription: index.description ?? "",
    namespaces: index.namespaces ?? [],
    staticPages: Array.from(new Set(staticPages)),
  };
}
