// The migration's core promise is URL parity: every URL that worked on the WordPress site
// works on Plexo at exactly the same path once the owner points their domain here — pages
// (/lineagecare/about-lineagecare/), media (/lineagecare/wp-content/uploads/…/photo.jpg),
// and the theme/plugin CSS, JS and fonts those pages load. Search rankings, backlinks,
// image-search results and every hardcoded asset URL buried in plugin JS keep resolving
// without a single redirect.
//
// Plexo serves a site as a tree of pages (Template.parentId/slug) and resolves a request by
// walking that tree one path segment at a time; whatever segments are left once the walk
// can't descend further are looked up as a TemplateAsset on the page it stopped at (see
// app/pub/[domain]/[[...slug]]/route.ts). So "mirroring the URL space" means: every page
// path becomes a node in that tree, and every asset is stored on the node that walk would
// stop at, under the remaining sub-path. resolveAssetOwner() below is that same walk.

/** Decoded, non-empty path segments of a URL's pathname ("/a/b%20c/" → ["a", "b c"]). */
export function pathSegments(url: string): string[] {
  const { pathname } = new URL(url);
  return pathname
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

/** Canonical lookup key for a page path: leading slash, decoded, no trailing slash ("/" for the root). */
export function pageKey(segments: string[]): string {
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

export function pageKeyForUrl(url: string): string {
  return pageKey(pathSegments(url));
}

/**
 * Given the set of page keys that exist in the migrated tree, returns which page an asset
 * at `assetPath` must be stored on, and under what relative path — exactly what the serve
 * route's tree walk will compute when a visitor requests that asset URL.
 */
export function resolveAssetOwner(pageKeys: Set<string>, assetSegments: string[]): { ownerKey: string; relPath: string } | null {
  const consumed: string[] = [];
  for (const segment of assetSegments) {
    const candidate = pageKey([...consumed, segment]);
    // The serve route also retries a ".html"/".htm" segment with the suffix stripped.
    const stripped = /\.html?$/i.test(segment) ? pageKey([...consumed, segment.replace(/\.html?$/i, "")]) : null;
    if (pageKeys.has(candidate) || (stripped && pageKeys.has(stripped))) {
      consumed.push(segment);
    } else {
      break;
    }
  }
  const rest = assetSegments.slice(consumed.length);
  if (rest.length === 0) return null; // the path IS a page, not an asset
  return { ownerKey: pageKey(consumed), relPath: rest.join("/") };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The source host and its www/non-www twin — WordPress sites are routinely linked under both. */
export function hostVariants(origin: string): string[] {
  const host = new URL(origin).host;
  return host.startsWith("www.") ? [host, host.slice(4)] : [host, `www.${host}`];
}

/**
 * Builds a function that turns every absolute reference to the source site — plain
 * (https://host/x), protocol-relative (//host/x), http or https, www or not, and the
 * JSON-escaped form WordPress prints inside inline config (https:\/\/host\/x) — into a
 * root-relative path (/x). Root-relative works on the visitor's current host, whether
 * that's the Plexo preview subdomain today or the owner's own domain after cutover.
 */
export function makeOriginRewriter(origin: string): (text: string) => string {
  const hosts = hostVariants(origin).map(escapeRegex).join("|");
  // (?:https?:)? then // or \/\/ then the host, then a lookahead for the end of the
  // authority (path, query, fragment, quote, whitespace…). Port-qualified hosts are left
  // alone on purpose: those are never the public site.
  const re = new RegExp(`(?:https?:)?(\\\\?/\\\\?/)(?:${hosts})(?=(\\\\?/)|[?#"'\\s)<>,]|$)`, "gi");
  return (text: string) =>
    text.replace(re, (_match, slashes: string, nextSlash: string | undefined) => {
      if (nextSlash) return ""; // "https://host/x" → "/x" (the path's own slash follows)
      // "https://host" with no path → "/" (escaped as "\/" inside JSON-escaped strings)
      return slashes.includes("\\") ? "\\/" : "/";
    });
}

/** Strips a query string/fragment and decodes — the key a referenced asset is stored under. */
export function assetPathFromRef(ref: string): string[] | null {
  const clean = ref.replace(/\\\//g, "/").split(/[?#]/)[0];
  if (!clean.startsWith("/") || clean.startsWith("//")) return null;
  const segments = clean.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  if (segments.length === 0) return null;
  if (segments.some((s) => s === ".." || s === ".")) return null;
  return segments;
}
