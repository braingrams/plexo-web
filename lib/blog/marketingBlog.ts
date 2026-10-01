// The plexo.io marketing blog is a single, platform-owned blog that reuses the exact same
// per-tenant blog data model (BlogPost/BlogAuthor/BlogCategory/BlogTag, all keyed by
// templateId — see lib/db/contentEntities.ts). Rather than introduce a parallel
// platform-scoped entity, it claims one reserved templateId that no real customer template
// can collide with. If plexo.io ever needs *multiple* first-party blogs (e.g. a separate
// engineering blog), this single constant becomes a small registry / a BlogSite lookup —
// every query function already takes templateId as its first argument, so nothing else changes.
export const MARKETING_BLOG_TEMPLATE_ID =
  process.env.MARKETING_BLOG_TEMPLATE_ID?.trim() || "plexo-marketing-blog";

export const MARKETING_BLOG_TITLE = "Blog";
export const MARKETING_BLOG_TAGLINE = "The Plexo Blog";
export const MARKETING_BLOG_DESCRIPTION =
  "Product updates, guides, and stories from the team building Plexo — the simple, user-friendly website builder.";

// Same resolution the root layout (app/layout.tsx) and sitemap (app/sitemap.ts) use, kept
// in sync deliberately: absolute origin for canonical URLs, JSON-LD, and RSS <link>s.
export const SITE_URL = process.env.NEXT_PUBLIC_APP_URL?.startsWith("http")
  ? process.env.NEXT_PUBLIC_APP_URL
  : "https://plexo.charisol.io";
