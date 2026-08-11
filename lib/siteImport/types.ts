import type { SiteImportPlatform } from "@prisma/client";

export type { SiteImportPlatform };

export interface DiscoveredUrl {
  url: string;
  likelyBlogPost: boolean;
  source: "sitemap" | "feed" | "link-crawl";
}

/** A blog post surfaced by a platform's own structured listing (WordPress REST, Squarespace ?format=json). */
export interface AdapterPostSummary {
  sourceUrl: string;
  title: string;
  dateIso: string | null;
}

export interface AdapterPostContent {
  html: string;
  excerpt?: string;
  author?: string;
  categories?: string[];
  tags?: string[];
  featuredImageUrl?: string | null;
}

/**
 * The per-platform seam: everything that differs between WordPress/Squarespace/Wix/Webflow
 * (and the UNKNOWN/generic fallback) lives behind this interface, so the crawl/fetch/classify/
 * link-rewrite machinery in crawl.ts/runJob.ts never branches on platform directly.
 */
export interface PlatformAdapter {
  platform: SiteImportPlatform;

  /**
   * Best-effort structured post list, if the platform exposes one (WordPress, Squarespace).
   * Returning null means "no platform API for this" — the generic RSS/Atom + sitemap
   * discovery path in crawl.ts is the only source of blog-post URLs for that platform.
   */
  listBlogPosts?(baseUrl: string): Promise<AdapterPostSummary[] | null>;

  /**
   * Full-fidelity single-post content fetch, if the platform exposes one. Returning null
   * (or the method being absent) means the post falls back to the shared
   * fetchRenderedHtml + Readability extraction path instead.
   */
  fetchBlogPostContent?(sourceUrl: string): Promise<AdapterPostContent | null>;

  /** Signatures this adapter knows are platform-tied and will not function post-migration. */
  detectInteractiveFeatures(html: string): string[];

  /** Whether this platform's regular (non-post) pages need headless rendering by default. */
  needsHeadlessByDefault: boolean;
}
