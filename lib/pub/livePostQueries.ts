import { listPublishedPosts, type BlogPostCard } from "@/lib/blog/queriesDynamo";
import { hasLivePostLists, renderLivePostLists, type LivePost } from "@/lib/pub/blogLivePostLists";

// Server-side half of lib/pub/blogLivePostLists.ts: fills a page's live post lists from the
// site's blog. Kept separate so the pure renderer stays importable anywhere.

export function toLivePost(post: BlogPostCard, basePath = "/blog"): LivePost {
  const category = post.categories[0]?.category ?? null;
  return {
    url: `${basePath}/${post.slug}`,
    title: post.title,
    excerpt: post.excerpt,
    imageUrl: post.featuredImageUrl,
    imageAlt: post.featuredImageAlt,
    publishedAt: post.publishedAt,
    authorName: post.author?.name ?? null,
    authorUrl: post.author ? `${basePath}/author/${post.author.slug}` : null,
    categoryName: category?.name ?? null,
    categoryUrl: category ? `${basePath}/category/${category.slug}` : null,
    readingMinutes: post.readingTimeMinutes,
  };
}

/** Every live list in `html` filled with the site's latest posts (honouring each list's count/offset/category). */
export async function fillLatestPostLists(html: string, siteTemplateId: string): Promise<string> {
  if (!hasLivePostLists(html)) return html;
  return renderLivePostLists(html, async (spec) => {
    const { posts } = await listPublishedPosts(siteTemplateId, {
      page: 1,
      perPage: spec.count + spec.offset,
      ...(spec.category ? { categorySlug: spec.category } : {}),
    });
    return posts.slice(spec.offset).map((p) => toLivePost(p));
  });
}
