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

function markerRegex(name: BlogMarkerName): RegExp {
  return new RegExp(`<div([^>]*)data-plexo-blog-${name}="true"([^>]*)></div>`, "g");
}

/** Cheap presence check — used to decide whether a layout is "ready" (has somewhere to show the real content) before the public renderer trusts it. */
export function hasBlogMarker(compiledHtml: string, name: BlogMarkerName): boolean {
  return new RegExp(`data-plexo-blog-${name}="true"`).test(compiledHtml);
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
