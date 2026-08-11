import { SiteImportPlatform } from "@prisma/client";
import type { AdapterPostContent, PlatformAdapter } from "../types";
import { detectInteractiveFeatures } from "../interactiveFeatureDetect";
import { safeFetch } from "../fetchSafe";

// Squarespace's own frontend fetches page data as JSON under the hood — appending
// ?format=json to any live page URL returns that same structured payload (semi-documented,
// widely relied on by Squarespace migration tooling, but not an official public API: treat
// failures as "fall back to generic extraction," never as fatal). There's no equivalent
// site-wide "list every blog post" endpoint without already knowing the blog collection's own
// path, so listBlogPosts is intentionally not implemented here — RSS/sitemap discovery
// (crawl.ts) finds the post URLs, and this adapter only upgrades per-post CONTENT fidelity
// once a URL is already known.
interface SquarespaceItemJson {
  title?: string;
  excerpt?: string;
  body?: string;
  author?: { displayName?: string };
  categories?: string[];
  tags?: string[];
  assetUrl?: string;
}

export const squarespaceAdapter: PlatformAdapter = {
  platform: SiteImportPlatform.SQUARESPACE,
  needsHeadlessByDefault: false,

  async fetchBlogPostContent(sourceUrl: string): Promise<AdapterPostContent | null> {
    try {
      const jsonUrl = new URL(sourceUrl);
      jsonUrl.searchParams.set("format", "json");
      const res = await safeFetch(jsonUrl.toString(), { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const data = (await res.json()) as { item?: SquarespaceItemJson };
      const item = data.item;
      if (!item?.body) return null;
      return {
        html: item.body,
        excerpt: item.excerpt,
        author: item.author?.displayName,
        categories: item.categories ?? [],
        tags: item.tags ?? [],
        featuredImageUrl: item.assetUrl ?? null,
      };
    } catch {
      return null; // caller falls back to the shared fetchRenderedHtml + Readability path
    }
  },

  detectInteractiveFeatures: (html) => detectInteractiveFeatures(html, SiteImportPlatform.SQUARESPACE),
};
