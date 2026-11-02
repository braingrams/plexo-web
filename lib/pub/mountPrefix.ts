// A site whose pages are stored under a folder ("/serenity/about") but should be visited without it
// ("/about") — what a WordPress site moved out of a folder of someone else's domain needs once it has a
// domain of its own. The stored site is untouched; the serve route maps addresses at the edge:
//   • visiting /about serves the stored /serenity/about,
//   • the old /serenity/... addresses permanently redirect to the clean ones,
//   • the text the site sends (pages, stylesheets, scripts) has its /serenity/ links shortened to match,
//     so nothing the page loads depends on the redirect.
// Any stored link this misses still works: it lands on the redirect.

/** "/serenity/" or "/serenity" → "/serenity"; anything unusable → null. */
export function normalizeMountPrefix(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = `/${value.split("/").filter(Boolean).join("/")}`;
  return clean === "/" || !/^\/[A-Za-z0-9._~%/-]+$/.test(clean) ? null : clean;
}

/** The stored path for a visitor's path segments: ["about"] → ["serenity", "about"]. */
export function mountedSegments(prefix: string, segments: string[]): string[] {
  return [...prefix.split("/").filter(Boolean), ...segments];
}

/** If the visitor's path starts with the prefix (an old address), the clean path to send them to; else null. */
export function cleanPathFor(prefix: string, segments: string[]): string | null {
  const own = prefix.split("/").filter(Boolean);
  if (segments.length < own.length || own.some((s, i) => segments[i] !== s)) return null;
  const rest = segments.slice(own.length);
  return `/${rest.join("/")}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Shortens the prefix inside text a page sends: root-relative links ("/serenity/x" → "/x", also the JSON-escaped
 * "\/serenity\/x"), and — when the source site's address is known — its absolute form
 * ("https://playmuzingo.com/serenity/x" → "https://<this site>/x"), so canonical and social-share tags name the
 * address visitors actually use.
 */
export function unmountText(text: string, opts: { prefix: string; sourceOrigin?: string | null; siteOrigin?: string }): string {
  const p = escapeRegex(opts.prefix.replace(/^\//, ""));
  let out = text;
  if (opts.siteOrigin) {
    // The source site's address, and this site's own address with the folder still in it (what Plexo writes into
    // canonical and share tags from the stored path) — both become the address visitors actually use.
    const hosts = [new URL(opts.siteOrigin).host, ...(opts.sourceOrigin ? [new URL(opts.sourceOrigin).host] : [])]
      .map((h) => escapeRegex(h.replace(/^www\./, "")))
      .join("|");
    const abs = new RegExp(`(?:https?:)?(\\\\?/\\\\?/)(?:www\\.)?(?:${hosts})(?:\\\\?/)${p}(?=(\\\\?/)|[?#"'\\s)<>,]|$)`, "gi");
    const site = new URL(opts.siteOrigin);
    out = out.replace(abs, (_m, slashes: string) => (slashes.includes("\\") ? `${site.protocol}\\/\\/${site.host}` : `${site.protocol}//${site.host}`));
  }
  // "/serenity/x" → "/x", and "/serenity" (the folder itself) → "/", only when it starts a path: after a quote, "(", "=", ",", ">" or whitespace.
  out = out.replace(new RegExp(`(^|["'(=,>\\s])/${p}(?=/)`, "g"), (_m, lead: string) => lead);
  out = out.replace(new RegExp(`(^|["'(=,>\\s])/${p}(?=["'?#)\\s<,]|$)`, "g"), (_m, lead: string) => `${lead}/`);
  // The same, JSON-escaped inside inline config: "\/serenity\/x".
  out = out.replace(new RegExp(`\\\\/${p}(?=\\\\/)`, "g"), "");
  return out;
}

/** Makes a redirect's Location clean when it points into the prefix. */
export function unmountLocation(prefix: string, location: string, requestUrl: string): string {
  try {
    const base = new URL(requestUrl);
    const target = new URL(location, base);
    if (target.origin !== base.origin) return location;
    const clean = cleanPathFor(prefix, target.pathname.split("/").filter(Boolean));
    if (clean === null) return location;
    const slash = target.pathname.endsWith("/") && clean !== "/" ? "/" : "";
    return `${clean}${slash}${target.search}${target.hash}`;
  } catch {
    return location;
  }
}
