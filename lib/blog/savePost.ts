import { BlogPost, BlogPostStatus } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { ensureUniqueBlogSlug } from "@/server/slug";
import { sanitizeBlogHtml } from "./sanitize";
import { estimateReadingTimeMinutes, autoExcerpt } from "./content";
import { revalidateBlogPost } from "./revalidate";

export interface SavePostInput {
  title: string;
  slug?: string | null;
  excerpt?: string | null;
  contentJson: unknown;
  contentHtml: string;
  featuredImageUrl?: string | null;
  featuredImageAlt?: string | null;
  status: BlogPostStatus;
  scheduledAt?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  ogImageUrl?: string | null;
  noindex?: boolean;
  authorId?: string | null;
  categoryIds?: string[];
  tagIds?: string[];
  // Importer-only fields — absent for the ordinary editor save path.
  externalId?: string | null;
  publishedAtOverride?: string | null;
}

function computePublishedAt(
  status: BlogPostStatus,
  scheduledAt: Date | null,
  existingPublishedAt: Date | null,
  override?: Date | null,
): Date | null {
  // The WordPress importer preserves the source post's original publish date rather
  // than stamping "now" on every migrated post.
  if (override) return override;
  if (status === BlogPostStatus.PUBLISHED) return existingPublishedAt ?? new Date();
  if (status === BlogPostStatus.SCHEDULED) return scheduledAt ?? existingPublishedAt ?? new Date();
  return existingPublishedAt; // DRAFT/ARCHIVED preserve prior publish history rather than wiping it
}

async function syncCategoriesAndTags(postId: string, categoryIds: string[] | undefined, tagIds: string[] | undefined) {
  if (categoryIds !== undefined) {
    await prisma.blogPostCategory.deleteMany({ where: { postId } });
    if (categoryIds.length > 0) {
      await prisma.blogPostCategory.createMany({
        data: categoryIds.map((categoryId) => ({ postId, categoryId })),
        skipDuplicates: true,
      });
    }
  }
  if (tagIds !== undefined) {
    await prisma.blogPostTag.deleteMany({ where: { postId } });
    if (tagIds.length > 0) {
      await prisma.blogPostTag.createMany({
        data: tagIds.map((tagId) => ({ postId, tagId })),
        skipDuplicates: true,
      });
    }
  }
}

async function slugsForRevalidate(postId: string): Promise<{ categorySlugs: string[]; tagSlugs: string[]; authorSlug: string | null }> {
  const [categories, tags, post] = await Promise.all([
    prisma.blogPostCategory.findMany({ where: { postId }, select: { category: { select: { slug: true } } } }),
    prisma.blogPostTag.findMany({ where: { postId }, select: { tag: { select: { slug: true } } } }),
    prisma.blogPost.findUnique({ where: { id: postId }, select: { author: { select: { slug: true } } } }),
  ]);
  return {
    categorySlugs: categories.map((c) => c.category.slug),
    tagSlugs: tags.map((t) => t.tag.slug),
    authorSlug: post?.author?.slug ?? null,
  };
}

/** Upsert key for the WordPress importer — lets a resumed/retried batch re-run safely without duplicating posts. */
export async function findPostByExternalId(templateId: string, externalId: string): Promise<BlogPost | null> {
  return prisma.blogPost.findUnique({ where: { templateId_externalId: { templateId, externalId } } });
}

export async function createBlogPost(templateId: string, input: SavePostInput): Promise<BlogPost> {
  const contentHtml = sanitizeBlogHtml(input.contentHtml);
  const slug = await ensureUniqueBlogSlug(templateId, input.slug?.trim() || input.title);
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  const publishedAt = computePublishedAt(input.status, scheduledAt, null, input.publishedAtOverride ? new Date(input.publishedAtOverride) : null);

  const post = await prisma.blogPost.create({
    data: {
      templateId,
      title: input.title.trim(),
      slug,
      excerpt: input.excerpt?.trim() || autoExcerpt(contentHtml),
      contentJson: input.contentJson as object,
      contentHtml,
      featuredImageUrl: input.featuredImageUrl || null,
      featuredImageAlt: input.featuredImageAlt || null,
      status: input.status,
      scheduledAt,
      publishedAt,
      metaTitle: input.metaTitle || null,
      metaDescription: input.metaDescription || null,
      ogImageUrl: input.ogImageUrl || null,
      noindex: input.noindex ?? false,
      readingTimeMinutes: estimateReadingTimeMinutes(input.contentJson),
      authorId: input.authorId || null,
      externalId: input.externalId || null,
    },
  });

  await syncCategoriesAndTags(post.id, input.categoryIds, input.tagIds);
  const { categorySlugs, tagSlugs, authorSlug } = await slugsForRevalidate(post.id);
  await revalidateBlogPost({ templateId, slug: post.slug, categorySlugs, tagSlugs, authorSlug });

  return post;
}

export async function updateBlogPost(templateId: string, postId: string, input: Partial<SavePostInput>): Promise<BlogPost | null> {
  const existing = await prisma.blogPost.findFirst({
    where: { id: postId, templateId },
    include: { categories: { select: { category: { select: { slug: true } } } }, tags: { select: { tag: { select: { slug: true } } } }, author: { select: { slug: true } } },
  });
  if (!existing) return null;

  const previousCategorySlugs = existing.categories.map((c) => c.category.slug);
  const previousTagSlugs = existing.tags.map((t) => t.tag.slug);
  const previousAuthorSlug = existing.author?.slug ?? null;
  const previousSlug = existing.slug;

  const data: Record<string, unknown> = {};

  if (input.title !== undefined) data.title = input.title.trim();
  if (input.slug !== undefined && input.slug !== null && input.slug.trim() && input.slug.trim() !== existing.slug) {
    data.slug = await ensureUniqueBlogSlug(templateId, input.slug.trim());
  }

  let contentHtml = existing.contentHtml;
  if (input.contentHtml !== undefined) {
    contentHtml = sanitizeBlogHtml(input.contentHtml);
    data.contentHtml = contentHtml;
  }
  if (input.contentJson !== undefined) {
    data.contentJson = input.contentJson as object;
    data.readingTimeMinutes = estimateReadingTimeMinutes(input.contentJson);
  }
  if (input.excerpt !== undefined) data.excerpt = input.excerpt?.trim() || autoExcerpt(contentHtml);
  if (input.featuredImageUrl !== undefined) data.featuredImageUrl = input.featuredImageUrl || null;
  if (input.featuredImageAlt !== undefined) data.featuredImageAlt = input.featuredImageAlt || null;
  if (input.metaTitle !== undefined) data.metaTitle = input.metaTitle || null;
  if (input.metaDescription !== undefined) data.metaDescription = input.metaDescription || null;
  if (input.ogImageUrl !== undefined) data.ogImageUrl = input.ogImageUrl || null;
  if (input.noindex !== undefined) data.noindex = input.noindex;
  if (input.authorId !== undefined) data.authorId = input.authorId || null;

  if (input.status !== undefined) {
    const scheduledAt = input.scheduledAt !== undefined ? (input.scheduledAt ? new Date(input.scheduledAt) : null) : existing.scheduledAt;
    data.status = input.status;
    data.scheduledAt = scheduledAt;
    data.publishedAt = computePublishedAt(input.status, scheduledAt, existing.publishedAt);
  } else if (input.scheduledAt !== undefined) {
    data.scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  }

  const post = await prisma.blogPost.update({ where: { id: postId }, data });
  await syncCategoriesAndTags(post.id, input.categoryIds, input.tagIds);

  const { categorySlugs, tagSlugs, authorSlug } = await slugsForRevalidate(post.id);
  await revalidateBlogPost({
    templateId,
    slug: post.slug,
    categorySlugs,
    tagSlugs,
    authorSlug,
    previousCategorySlugs,
    previousTagSlugs,
    previousAuthorSlug,
  });
  if (previousSlug !== post.slug) {
    await revalidateBlogPost({ templateId, slug: previousSlug, categorySlugs: [], tagSlugs: [], authorSlug: null });
  }

  return post;
}

export async function deleteBlogPost(templateId: string, postId: string): Promise<boolean> {
  const existing = await prisma.blogPost.findFirst({
    where: { id: postId, templateId },
    select: {
      slug: true,
      categories: { select: { category: { select: { slug: true } } } },
      tags: { select: { tag: { select: { slug: true } } } },
      author: { select: { slug: true } },
    },
  });
  if (!existing) return false;

  await prisma.blogPost.delete({ where: { id: postId } });
  await revalidateBlogPost({
    templateId,
    slug: existing.slug,
    categorySlugs: [],
    tagSlugs: [],
    authorSlug: null,
    previousCategorySlugs: existing.categories.map((c) => c.category.slug),
    previousTagSlugs: existing.tags.map((t) => t.tag.slug),
    previousAuthorSlug: existing.author?.slug ?? null,
  });
  return true;
}
