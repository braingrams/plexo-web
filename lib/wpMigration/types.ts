// Shared shapes for the WordPress → Plexo migration engine (lib/wpMigration/*).
//
// Unlike lib/siteImport (a generic "crawl any site" importer), this engine is
// WordPress-specific end to end: it reads the site's own REST API for a complete,
// authoritative inventory instead of guessing from links, and it preserves the source
// site's URL space exactly (pages, media, theme/plugin assets all keep their original
// paths) so nothing — search rankings, backlinks, image-search hits, hardcoded asset URLs
// inside plugin JS/CSS — breaks when the owner points their domain at Plexo.

export interface WpInstall {
  /** Scheme + host the visitor-facing site lives on, e.g. "https://lineagecarefoundation.org". */
  origin: string;
  /** WordPress "home" URL without trailing slash — may be a subdirectory ("https://x.org/lineagecare"). */
  homeUrl: string;
  /** REST API root with trailing slash ("https://x.org/lineagecare/wp-json/" or "https://x.org/?rest_route=/"). */
  restRoot: string;
  siteName: string;
  siteDescription: string;
  /** REST namespaces the install exposes — the most reliable public signal of which plugins are active. */
  namespaces: string[];
  /**
   * Same-origin pages found while locating WordPress that are NOT part of the WordPress
   * install (a hand-written splash/landing page at the domain root in front of a WP
   * install in a subdirectory, for example). They're migrated too — the owner's visitors
   * see them, so they're part of "the site" whatever generated them.
   */
  staticPages: string[];
}

export interface WpSeo {
  title: string | null;
  description: string | null;
  canonical: string | null;
  robots: { index?: string; follow?: string } | null;
  ogImage: string | null;
}

export interface WpPageEntry {
  id: number;
  link: string;
  title: string;
  parent: number;
  menuOrder: number;
  modifiedGmt: string | null;
  seo: WpSeo;
}

export interface WpPostEntry {
  id: number;
  link: string;
  slug: string;
  title: string;
  contentHtml: string;
  excerptHtml: string;
  dateGmt: string | null;
  modifiedGmt: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  categoryNames: string[];
  tagNames: string[];
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
  seo: WpSeo;
}

export interface WpTermEntry {
  taxonomy: "category" | "post_tag";
  slug: string;
  name: string;
  link: string;
}

export interface WpMediaEntry {
  id: number;
  sourceUrl: string;
  mimeType: string;
  /** The attachment page permalink (e.g. /lineagecare/home/photo-1/) — redirected to the file itself. */
  link: string | null;
}

export type PluginOutcome =
  /** Replaced by a built-in Plexo feature that does the same job. */
  | "NATIVE"
  /** Front-end only (sliders, galleries, animations, page-builder output) — carried over and keeps working as-is. */
  | "PRESERVED"
  /** Has server-side behavior Plexo has to rebuild before it works again — blocks domain cutover until resolved. */
  | "NEEDS_ATTENTION"
  /** WordPress infrastructure/admin tooling with no visitor-facing role — nothing to migrate. */
  | "NOT_NEEDED";

export interface DetectedPlugin {
  slug: string;
  name: string;
  outcome: PluginOutcome;
  /** Plain-language explanation for a non-technical site owner of what happened to this plugin. */
  explanation: string;
  /** Where we saw it — a REST namespace, an asset path, an Elementor widget prefix. */
  evidence: string[];
}

export interface WpInventory {
  install: WpInstall;
  pages: WpPageEntry[];
  posts: WpPostEntry[];
  terms: WpTermEntry[];
  media: WpMediaEntry[];
  plugins: DetectedPlugin[];
  theme: { slug: string; parentSlug: string | null } | null;
  /** The page WordPress serves at its home URL, if the front page is a static page. */
  frontPageId: number | null;
}
