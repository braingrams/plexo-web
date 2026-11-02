import { listPublishedPosts } from "@/lib/blog/queriesDynamo";
import { toLivePost } from "@/lib/pub/livePostQueries";
import { formatPostDate } from "@/lib/pub/blogLivePostLists";

// The site's blog as a content source: data-plexo-content="blog" shows the latest published posts on ANY page
// (Home's "From the Blog", a sidebar, a landing page) in the page's own style, each card linking to its post.
// New posts appear on their own — nothing to copy or update by hand. Same markers, same widget as videos/stories.

export const BLOG_SLUG = "blog";

export type BlogItem = {
  id: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  link: string;
  /** "Oct 10, 2026" */
  dateLabel: string;
  createdAt?: string;
};

export async function listBlogItems(siteTemplateId: string, limit = 48): Promise<BlogItem[]> {
  const { posts } = await listPublishedPosts(siteTemplateId, { page: 1, perPage: Math.min(Math.max(limit, 1), 48) });
  return posts.map((p) => {
    const live = toLivePost(p);
    return {
      id: p.slug,
      title: live.title,
      description: live.excerpt ?? "",
      image: live.imageUrl ?? "",
      imageAlt: live.imageAlt ?? "",
      link: live.url,
      dateLabel: formatPostDate(live.publishedAt, "mdy-short"),
      createdAt: live.publishedAt ? new Date(live.publishedAt).toISOString() : undefined,
    };
  });
}
