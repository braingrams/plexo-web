import { BlogPost, BlogAuthor, BlogCategory, BlogTag, BlogPostCategory, BlogPostTag, BlogComment } from "@/lib/db/contentEntities";
import type { EntityItem } from "electrodb";

type PostItem = EntityItem<typeof BlogPost>;
type CategoryItem = EntityItem<typeof BlogCategory>;
type TagItem = EntityItem<typeof BlogTag>;
type AuthorItem = EntityItem<typeof BlogAuthor>;

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

// -----------------------------------------------------------------------------------
// DynamoDB ports of the rest of lib/blog/queries.ts — the actual public-rendering query
// layer (listing/detail/archive lookups), not just the hydration helpers above. Every
// query here fetches the site's full byStatus (GSI1) partition and filters/sorts/paginates
// in application code rather than trying to express Prisma's arbitrary WHERE clauses as
// DynamoDB key conditions — same "small in practice, one partition per site" bound this
// migration uses throughout (see hydratePostCards above, blogTools.ts's list_blog_posts).

/** SCHEDULED behaves identically to PUBLISHED once its date has passed (see effectiveStatus
 * above) — there's no cron flipping the status attribute, so "is it visible" is purely a
 * function of publishedAt. */
function isPubliclyVisible(post: PostItem): boolean {
  if (!post.publishedAt) return false;
  if (post.publishedAt > new Date().toISOString()) return false;
  return post.status === "PUBLISHED" || post.status === "SCHEDULED";
}

async function loadTemplatePosts(templateId: string): Promise<PostItem[]> {
  const { data } = await BlogPost.query.byStatus({ templateId }).go();
  return data;
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

  const allPosts = await loadTemplatePosts(templateId);
  let filtered = allPosts.filter(isPubliclyVisible);

  if (opts.categorySlug) {
    const { data: category } = await BlogCategory.get({ templateId, slug: opts.categorySlug }).go();
    if (!category) {
      filtered = [];
    } else {
      const { data: links } = await BlogPostCategory.query.byCategory({ categoryId: category.id }).go();
      const postIds = new Set(links.map((l) => l.postId));
      filtered = filtered.filter((p) => postIds.has(p.id));
    }
  }
  if (opts.tagSlug) {
    const { data: tag } = await BlogTag.get({ templateId, slug: opts.tagSlug }).go();
    if (!tag) {
      filtered = [];
    } else {
      const { data: links } = await BlogPostTag.query.byTag({ tagId: tag.id }).go();
      const postIds = new Set(links.map((l) => l.postId));
      filtered = filtered.filter((p) => postIds.has(p.id));
    }
  }
  if (opts.authorSlug) {
    const { data: author } = await BlogAuthor.get({ templateId, slug: opts.authorSlug }).go();
    filtered = author ? filtered.filter((p) => p.authorId === author.id) : [];
  }

  filtered = [...filtered].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));

  const total = filtered.length;
  const pageItems = filtered.slice((page - 1) * perPage, page * perPage);
  const posts = await hydratePostCards(templateId, pageItems);

  return { posts, total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}

export async function getPublishedPostBySlug(templateId: string, slug: string): Promise<BlogPostDetail | null> {
  const { data: post } = await BlogPost.get({ templateId, slug }).go();
  if (!post || !isPubliclyVisible(post)) return null;
  return hydratePostDetail(templateId, post);
}

/** Bypasses the published-only gate for the dashboard's signed-token preview link. */
export async function getPreviewPost(templateId: string, slug: string): Promise<BlogPostDetail | null> {
  const { data: post } = await BlogPost.get({ templateId, slug }).go();
  if (!post) return null;
  return hydratePostDetail(templateId, post);
}

export async function getCategoryBySlug(templateId: string, slug: string): Promise<CategoryItem | null> {
  const { data } = await BlogCategory.get({ templateId, slug }).go();
  return data;
}

export async function getTagBySlug(templateId: string, slug: string): Promise<TagItem | null> {
  const { data } = await BlogTag.get({ templateId, slug }).go();
  return data;
}

export async function getAuthorBySlug(templateId: string, slug: string): Promise<AuthorItem | null> {
  const { data } = await BlogAuthor.get({ templateId, slug }).go();
  return data;
}

export async function listAllCategories(templateId: string): Promise<CategoryItem[]> {
  const { data } = await BlogCategory.query.primary({ templateId }).go();
  return [...data].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listAllTags(templateId: string): Promise<TagItem[]> {
  const { data } = await BlogTag.query.primary({ templateId }).go();
  return [...data].sort((a, b) => a.name.localeCompare(b.name));
}

export interface PublishedSlugEntry {
  slug: string;
  updatedAt: Date;
  publishedAt: Date | null;
  title: string;
  excerpt: string | null;
}

/** Published posts' slug/dates/title/excerpt — for the per-tenant sitemap (no limit) and RSS feed (limit ~50). */
export async function listAllPublishedSlugs(templateId: string, limit?: number): Promise<PublishedSlugEntry[]> {
  const allPosts = await loadTemplatePosts(templateId);
  const visible = allPosts
    .filter(isPubliclyVisible)
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  const sliced = typeof limit === "number" ? visible.slice(0, limit) : visible;
  return sliced.map((p) => ({
    slug: p.slug,
    updatedAt: p.updatedAt ? new Date(p.updatedAt) : new Date(),
    publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
    title: p.title,
    excerpt: p.excerpt ?? null,
  }));
}

/** Same-category/tag posts, most recent first, excluding the post itself — simple relevance scoring. */
export async function getRelatedPosts(templateId: string, post: BlogPostDetail, limit = 3): Promise<BlogPostCard[]> {
  const categorySlugs = post.categories.map((c) => c.category.slug);
  const tagSlugs = post.tags.map((t) => t.tag.slug);
  if (categorySlugs.length === 0 && tagSlugs.length === 0) return [];

  const [{ data: categories }, { data: tags }] = await Promise.all([
    BlogCategory.query.primary({ templateId }).go(),
    BlogTag.query.primary({ templateId }).go(),
  ]);
  const categoryIds = categories.filter((c) => categorySlugs.includes(c.slug)).map((c) => c.id);
  const tagIds = tags.filter((t) => tagSlugs.includes(t.slug)).map((t) => t.id);

  const [categoryLinkBatches, tagLinkBatches] = await Promise.all([
    Promise.all(categoryIds.map((categoryId) => BlogPostCategory.query.byCategory({ categoryId }).go())),
    Promise.all(tagIds.map((tagId) => BlogPostTag.query.byTag({ tagId }).go())),
  ]);
  const relatedPostIds = new Set<string>();
  for (const batch of categoryLinkBatches) for (const link of batch.data) relatedPostIds.add(link.postId);
  for (const batch of tagLinkBatches) for (const link of batch.data) relatedPostIds.add(link.postId);
  relatedPostIds.delete(post.id);

  const allPosts = await loadTemplatePosts(templateId);
  const related = allPosts
    .filter((p) => relatedPostIds.has(p.id) && isPubliclyVisible(p))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, limit);

  return hydratePostCards(templateId, related);
}

export interface ApprovedCommentRow {
  id: string;
  authorName: string;
  body: string;
  createdAt: Date;
  parentId: string | null;
}

/** Approved comments for one post (top-level + one level of replies) — see lib/pub/renderComments.ts
 * for how these get rendered. status is a prefix of this entity's own sort key (see
 * contentEntities.ts), so this is a real begins_with query, not a filtered full-partition scan. */
export async function listApprovedComments(postId: string): Promise<ApprovedCommentRow[]> {
  const { data } = await BlogComment.query.primary({ postId, status: "APPROVED" }).go();
  return data
    .map((c) => ({
      id: c.id,
      authorName: c.authorName,
      body: c.body,
      createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
      parentId: c.parentId ?? null,
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
