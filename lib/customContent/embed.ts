// The marker public/plexo-content.js looks for — one plain div that works in the visual builder
// (an HTML block), a raw HTML upload, and a React project alike. Client-safe (no server imports).

export type ContentLayout = "gallery" | "stories" | "events" | "list" | "posts";

/** The layout that suits a content type, judged from its slug (Videos → gallery, Stories → stories, Happenings/Events → events). */
export function defaultLayoutForSlug(slug: string): ContentLayout {
  if (slug === "blog") return "posts";
  if (/video|gallery|watch/.test(slug)) return "gallery";
  if (/event|happening|workshop|webinar/.test(slug)) return "events";
  if (/stor|post|article|news/.test(slug)) return "stories";
  return "list";
}

export function contentSnippet(slug: string, opts: { layout?: ContentLayout; limit?: number; columns?: number } = {}): string {
  const layout = opts.layout ?? defaultLayoutForSlug(slug);
  const attrs = [`data-plexo-content="${slug}"`, `data-plexo-content-layout="${layout}"`];
  if (opts.limit) attrs.push(`data-plexo-content-limit="${opts.limit}"`);
  if (opts.columns) attrs.push(`data-plexo-content-columns="${opts.columns}"`);
  return `<div ${attrs.join(" ")}></div>`;
}
