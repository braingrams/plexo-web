import { BlogPost, BlogAuthor, BlogCategory, BlogTag, BlogPostCategory, BlogPostTag } from "@/lib/db/contentEntities";
import type { EntityItem } from "electrodb";

type PostItem = EntityItem<typeof BlogPost>;

export type BlogPostCard = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
  publishedAt: Date | null;
  readingTimeMinutes: number | null;
  author: { name: string; slug: string; avatarUrl: string | null } | null;
  categories: { category: { name: string; slug: string } }[];
  tags: { tag: { name: string; slug: string } }[];
};

export type BlogPostDetail = BlogPostCard & {
  contentHtml: string;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  noindex: boolean;
  commentsEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  status: string;
};

/**
 * DynamoDB-stack equivalent of lib/blog/queries.ts's CARD_SELECT/DETAIL_SELECT — Prisma's
 * `include` did this join in one query; here it's an explicit hydration step, since
 * BlogAuthor/BlogCategory/BlogTag aren't looked up by id directly (their own primary keys
 * are slug-based, see contentEntities.ts) and the post<->category/tag link tables
 * (BlogPostCategory/BlogPostTag) are separate items. Fetches the whole template's
 * author/category/tag sets once and reuses them across every post passed in, rather than
 * re-querying per post — same "small in practice" bound as the rest of this migration's
 * per-template lookups.
 */
export async function hydratePostCards(templateId: string, posts: PostItem[]): Promise<BlogPostCard[]> {
  if (posts.length === 0) return [];

  const [{ data: authors }, { data: categories }, { data: tags }, postCategoryBatches, postTagBatches] = await Promise.all([
    BlogAuthor.query.primary({ templateId }).go(),
    BlogCategory.query.primary({ templateId }).go(),
    BlogTag.query.primary({ templateId }).go(),
    Promise.all(posts.map((p) => BlogPostCategory.query.primary({ templateId, postId: p.id }).go())),
    Promise.all(posts.map((p) => BlogPostTag.query.primary({ templateId, postId: p.id }).go())),
  ]);
  const authorById = new Map(authors.map((a) => [a.id, a]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const tagById = new Map(tags.map((t) => [t.id, t]));

  return posts.map((post, i) => {
    const author = post.authorId ? authorById.get(post.authorId) : undefined;
    const postCategories = postCategoryBatches[i].data
      .map((pc) => categoryById.get(pc.categoryId))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => ({ category: { name: c.name, slug: c.slug } }));
    const postTags = postTagBatches[i].data
      .map((pt) => tagById.get(pt.tagId))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => ({ tag: { name: t.name, slug: t.slug } }));

    return {
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt ?? null,
      featuredImageUrl: post.featuredImageUrl ?? null,
      featuredImageAlt: post.featuredImageAlt ?? null,
      publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
      readingTimeMinutes: post.readingTimeMinutes ?? null,
      author: author ? { name: author.name, slug: author.slug, avatarUrl: author.avatarUrl ?? null } : null,
      categories: postCategories,
      tags: postTags,
    };
  });
}

export async function hydratePostDetail(templateId: string, post: PostItem): Promise<BlogPostDetail> {
  const [card] = await hydratePostCards(templateId, [post]);
  return {
    ...card,
    contentHtml: post.contentHtml,
    metaTitle: post.metaTitle ?? null,
    metaDescription: post.metaDescription ?? null,
    ogImageUrl: post.ogImageUrl ?? null,
    noindex: post.noindex ?? false,
    commentsEnabled: post.commentsEnabled ?? true,
    createdAt: post.createdAt ? new Date(post.createdAt) : new Date(),
    updatedAt: post.updatedAt ? new Date(post.updatedAt) : new Date(),
    status: post.status ?? "DRAFT",
  };
}

/** DynamoDB port of lib/blog/queries.ts's effectiveStatus — pure, unchanged logic, just
 * re-typed to plain strings instead of the Prisma enum. */
export function effectiveStatus(status: string, publishedAt: string | null): string {
  if (status === "SCHEDULED" && publishedAt && new Date(publishedAt) <= new Date()) {
    return "PUBLISHED";
  }
  return status;
}
