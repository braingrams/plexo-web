import { SiteImportPlatform } from "@prisma/client";
import type { AdapterPostContent, AdapterPostSummary, PlatformAdapter } from "../types";
import { detectInteractiveFeatures } from "../interactiveFeatureDetect";
import { checkWordPressReachable, fetchWordPressPostBySlug, fetchWordPressPostsPage } from "@/lib/blogImport/wpClient";

// Deliberately thin glue, not a reimplementation: WordPress already has a proven, full-fidelity
// blog-post pipeline (lib/blogImport/wpClient.ts + runBatch.ts's stripWordPressCruft ->
// sanitizeBlogHtml -> generateJSON conversion), built and hardened for the existing blog-only
// importer. Site-import's WordPress support is "reuse that unchanged for posts, add page-crawl
// logic (crawl.ts) for everything that isn't a post."
export const wordpressAdapter: PlatformAdapter = {
  platform: SiteImportPlatform.WORDPRESS,
  needsHeadlessByDefault: false,

  async listBlogPosts(baseUrl: string): Promise<AdapterPostSummary[] | null> {
    const { reachable } = await checkWordPressReachable(baseUrl);
    if (!reachable) return null;

    const summaries: AdapterPostSummary[] = [];
    let page = 1;
    // Bounded rather than "until done" — a page cap is enforced at the crawl-discovery level
    // (see crawl.ts's maxPages), this is just a sane upper bound on API pages fetched here.
    const MAX_PAGES = 20;
    for (; page <= MAX_PAGES; page++) {
      const { posts, totalPages } = await fetchWordPressPostsPage(baseUrl, page, 50);
      for (const p of posts) summaries.push({ sourceUrl: p.link, title: p.title, dateIso: p.dateGmt || null });
      if (page >= totalPages || posts.length === 0) break;
    }
    return summaries;
  },

  async fetchBlogPostContent(sourceUrl: string): Promise<AdapterPostContent | null> {
    // wp-json/wp/v2/posts is keyed by numeric id or a slug filter, not a direct "fetch by
    // permalink" call — resolve via the slug in the URL's last path segment.
    const base = new URL(sourceUrl);
    const slug = base.pathname.replace(/\/+$/, "").split("/").pop();
    if (!slug) return null;
    const post = await fetchWordPressPostBySlug(`${base.protocol}//${base.host}`, slug);
    if (!post) return null;
    return {
      html: post.contentHtml,
      excerpt: post.excerptHtml,
      author: post.author?.name,
      categories: post.categories.map((c) => c.name),
      tags: post.tags.map((t) => t.name),
      featuredImageUrl: post.featuredMedia?.url ?? null,
    };
  },

  detectInteractiveFeatures: (html) => detectInteractiveFeatures(html, SiteImportPlatform.WORDPRESS),
};
