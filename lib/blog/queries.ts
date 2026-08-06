import { BlogPostStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/prisma";

const CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  featuredImageUrl: true,
  featuredImageAlt: true,
  publishedAt: true,
  readingTimeMinutes: true,
  author: { select: { name: true, slug: true, avatarUrl: true } },
  categories: { select: { category: { select: { name: true, slug: true } } } },
  tags: { select: { tag: { select: { name: true, slug: true } } } },
} satisfies Prisma.BlogPostSelect;

const DETAIL_SELECT = {
  ...CARD_SELECT,
  contentHtml: true,
  metaTitle: true,
  metaDescription: true,
  ogImageUrl: true,
  noindex: true,
  commentsEnabled: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BlogPostSelect;

export type BlogPostCard = Prisma.BlogPostGetPayload<{ select: typeof CARD_SELECT }>;
export type BlogPostDetail = Prisma.BlogPostGetPayload<{ select: typeof DETAIL_SELECT }>;

// SCHEDULED behaves identically to PUBLISHED once its date has passed — there's no cron
// flipping the status column, so "is it visible" is purely a function of publishedAt.
// (The admin list still shows the distinct "Scheduled" label — see effectiveStatus below.)
function publishedWhere(templateId: string): Prisma.BlogPostWhereInput {
  return {
    templateId,
    status: { in: [BlogPostStatus.PUBLISHED, BlogPostStatus.SCHEDULED] },
    publishedAt: { lte: new Date() },
  };
}

/** DB status is the source of truth for intent, but a past-due SCHEDULED post reads as PUBLISHED everywhere it's displayed. */
export function effectiveStatus(status: BlogPostStatus, publishedAt: Date | null): BlogPostStatus {
  if (status === BlogPostStatus.SCHEDULED && publishedAt && publishedAt <= new Date()) {
    return BlogPostStatus.PUBLISHED;
  }
  return status;
}

export interface ListPostsOptions {
  page?: number;
  perPage?: number;
  categorySlug?: string;
  tagSlug?: string;
  authorSlug?: string;
}

export interface ListPostsResult {
  posts: BlogPostCard[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export async function listPublishedPosts(templateId: string, opts: ListPostsOptions = {}): Promise<ListPostsResult> {
  const perPage = opts.perPage ?? 10;
  const page = Math.max(1, opts.page ?? 1);

  const where: Prisma.BlogPostWhereInput = { ...publishedWhere(templateId) };
  if (opts.categorySlug) where.categories = { some: { category: { slug: opts.categorySlug } } };
  if (opts.tagSlug) where.tags = { some: { tag: { slug: opts.tagSlug } } };
  if (opts.authorSlug) where.author = { slug: opts.authorSlug };

  const [posts, total] = await Promise.all([
    prisma.blogPost.findMany({
      where,
      select: CARD_SELECT,
      orderBy: { publishedAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.blogPost.count({ where }),
  ]);

  return { posts, total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}

export async function getPublishedPostBySlug(templateId: string, slug: string): Promise<BlogPostDetail | null> {
  return prisma.blogPost.findFirst({
    where: { ...publishedWhere(templateId), slug },
    select: DETAIL_SELECT,
  });
}

/** Bypasses the published-only gate for the dashboard's signed-token preview link. */
export async function getPreviewPost(templateId: string, slug: string): Promise<BlogPostDetail | null> {
  return prisma.blogPost.findFirst({
    where: { templateId, slug },
    select: DETAIL_SELECT,
  });
}

export async function getCategoryBySlug(templateId: string, slug: string) {
  return prisma.blogCategory.findFirst({ where: { templateId, slug } });
}

export async function getTagBySlug(templateId: string, slug: string) {
  return prisma.blogTag.findFirst({ where: { templateId, slug } });
}

export async function getAuthorBySlug(templateId: string, slug: string) {
  return prisma.blogAuthor.findFirst({ where: { templateId, slug } });
}

export async function listAllCategories(templateId: string) {
  return prisma.blogCategory.findMany({ where: { templateId }, orderBy: { name: "asc" } });
}

export async function listAllTags(templateId: string) {
  return prisma.blogTag.findMany({ where: { templateId }, orderBy: { name: "asc" } });
}

/** Published posts' slug/dates/title/excerpt — for the per-tenant sitemap (no limit) and RSS feed (limit ~50). */
export async function listAllPublishedSlugs(templateId: string, limit?: number) {
  return prisma.blogPost.findMany({
    where: publishedWhere(templateId),
    select: { slug: true, updatedAt: true, publishedAt: true, title: true, excerpt: true },
    orderBy: { publishedAt: "desc" },
    take: limit,
  });
}

/** Same-category/tag posts, most recent first, excluding the post itself — simple relevance scoring. */
export async function getRelatedPosts(templateId: string, post: BlogPostDetail, limit = 3): Promise<BlogPostCard[]> {
  const categorySlugs = post.categories.map((c) => c.category.slug);
  const tagSlugs = post.tags.map((t) => t.tag.slug);
  if (categorySlugs.length === 0 && tagSlugs.length === 0) return [];

  return prisma.blogPost.findMany({
    where: {
      ...publishedWhere(templateId),
      id: { not: post.id },
      OR: [
        categorySlugs.length ? { categories: { some: { category: { slug: { in: categorySlugs } } } } } : undefined,
        tagSlugs.length ? { tags: { some: { tag: { slug: { in: tagSlugs } } } } } : undefined,
      ].filter(Boolean) as Prisma.BlogPostWhereInput[],
    },
    select: CARD_SELECT,
    orderBy: { publishedAt: "desc" },
    take: limit,
  });
}

/** Approved comments for one post (top-level + one level of replies) — see lib/pub/renderComments.ts for how these get rendered. */
export async function listApprovedComments(postId: string) {
  return prisma.blogComment.findMany({
    where: { postId, status: "APPROVED" },
    orderBy: { createdAt: "asc" },
    select: { id: true, authorName: true, body: true, createdAt: true, parentId: true },
  });
}
