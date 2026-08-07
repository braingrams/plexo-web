// Marker names must exactly match what plexo-sdk's compiler emits for the "Blog" block
// family (see that repo's utilities/compiler.ts / compilerClient.ts / PlexoRenderer.tsx —
// data-plexo-blog-${camelCase(type.replace(/^blog_/, ''))}). Kept as a single source of
// truth here so every caller (settings status hint, post/listing renderers) agrees.
export const BLOG_MARKER_NAMES = [
  "title",
  "content",
  "featuredImage",
  "date",
  "author",
  "categories",
  "comments",
  "postList",
] as const;

export type BlogMarkerName = (typeof BLOG_MARKER_NAMES)[number];

// Case-insensitive: `data-plexo-blog-featuredImage`/`data-plexo-blog-postList` are the
// canonical camelCase names the SDK's compiler source emits, but any code path that ever
// round-trips the compiled HTML through real DOM attribute APIs (e.g. `setAttribute`,
// which the HTML spec lowercases for HTML documents) silently flattens them to
// `data-plexo-blog-featuredimage`/`data-plexo-blog-postlist` before they're persisted —
// matching case-insensitively here is what actually makes marker substitution robust to
// that, rather than depending on every future compile path preserving case exactly.
function markerRegex(name: BlogMarkerName): RegExp {
  return new RegExp(`<div([^>]*)data-plexo-blog-${name}="true"([^>]*)></div>`, "gi");
}

/** Cheap presence check — used to decide whether a layout is "ready" (has somewhere to show the real content) before the public renderer trusts it. */
export function hasBlogMarker(compiledHtml: string, name: BlogMarkerName): boolean {
  return new RegExp(`data-plexo-blog-${name}="true"`, "i").test(compiledHtml);
}

function unescapeHtmlAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Reads back the optional "Prefix" text (see plexo-sdk's BlogTextPropertiesAccordion) a
 * blog_date/blog_author/blog_categories marker was given in the builder — emitted as a
 * data-plexo-blog-prefix attribute on the marker div itself (see that SDK's compiler.ts),
 * since real per-post prefix text isn't something the SDK can produce on its own. Matches
 * the marker's full opening tag first so this can't accidentally read a prefix attribute
 * belonging to some other, unrelated element elsewhere in the compiled document.
 */
export function extractMarkerPrefix(compiledHtml: string, name: BlogMarkerName): string {
  const openTagMatch = new RegExp(`<div[^>]*data-plexo-blog-${name}="true"[^>]*>`, "i").exec(compiledHtml);
  if (!openTagMatch) return "";
  const prefixMatch = /data-plexo-blog-prefix="([^"]*)"/.exec(openTagMatch[0]);
  return prefixMatch ? unescapeHtmlAttr(prefixMatch[1]) : "";
}

/**
 * Splices real post/listing HTML fragments into a custom layout's compiled HTML.
 * Preserves each marker div's own attributes (style, etc. — the padding/width/background
 * the user set for that block in the builder) and injects the fragment as its inner
 * content. Markers with no fragment supplied in `fragments` are left as empty divs
 * (collapse visually) — every Blog block except the required one (Post Content for a
 * post layout, Post List for a listing layout) is genuinely optional.
 */
export function substituteBlogMarkers(compiledHtml: string, fragments: Partial<Record<BlogMarkerName, string>>): string {
  let result = compiledHtml;
  for (const name of BLOG_MARKER_NAMES) {
    const fragment = fragments[name];
    if (fragment === undefined) continue;
    result = result.replace(markerRegex(name), (_match, attrsBefore: string, attrsAfter: string) => {
      return `<div${attrsBefore}data-plexo-blog-${name}="true"${attrsAfter}>${fragment}</div>`;
    });
  }
  return result;
}
