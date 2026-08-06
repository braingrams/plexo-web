import { BlogPostStatus, ImportJobStatus, ImportSourceType } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { fetchWordPressPostsPage } from "./wpClient";
import { parseWxr, wxrDateToIso } from "./wxrParser";
import { findOrCreateCategory, findOrCreateTag, findOrCreateAuthor } from "./taxonomy";
import { rehostMediaUrls, extractImageUrls, rewriteImageUrls } from "./mediaRehost";
import { convertWordPressHtmlToTiptapJson, tiptapJsonToHtml, detectShortcodes } from "./htmlToTiptap";
import { createBlogPost, updateBlogPost, findPostByExternalId } from "@/lib/blog/savePost";
import { createRedirectsForImportedPost } from "./redirects";

// Media rehosting dominates batch time (each post can have several images, each a
// sequential-ish network round trip even with internal concurrency) — kept small so one
// batch comfortably finishes well inside a serverless function's time budget.
const POSTS_PER_BATCH = 5;

interface RestCursor {
  page: number;
  perPage: number;
}

interface WxrCursor {
  offset: number;
  batchSize: number;
}

/** Both WP_REST (live site) and WXR_UPLOAD (export file) posts get adapted to this one shape before the shared per-post import logic runs. */
interface NormalizedImportPost {
  externalId: string;
  title: string;
  link: string;
  contentHtml: string;
  excerptHtml: string;
  dateIso: string | null;
  slug: string;
  authorName: string | null;
  authorAvatarUrl?: string | null;
  categoryNames: string[];
  tagNames: string[];
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
}

function asErrorArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

/** The shared work for one post, regardless of which source produced it: dedupe taxonomy/author, rehost media, convert content, upsert, and write redirects. */
async function importOnePost(templateId: string, post: NormalizedImportPost, errors: string[]): Promise<void> {
  const [categoryIds, tagIds, authorId] = await Promise.all([
    Promise.all(post.categoryNames.map((name) => findOrCreateCategory(templateId, name))),
    Promise.all(post.tagNames.map((name) => findOrCreateTag(templateId, name))),
    post.authorName ? findOrCreateAuthor(templateId, post.authorName, post.authorAvatarUrl) : Promise.resolve(null),
  ]);

  const shortcodes = detectShortcodes(post.contentHtml);
  if (shortcodes.length > 0) {
    errors.push(`"${post.title}": removed unsupported shortcode(s) ${shortcodes.slice(0, 3).join(", ")} — please check this post.`);
  }

  const imageUrls = [post.featuredImageUrl, ...extractImageUrls(post.contentHtml)].filter((u): u is string => Boolean(u));
  const mediaMap = await rehostMediaUrls(templateId, imageUrls, errors);
  const rewrittenHtml = rewriteImageUrls(post.contentHtml, mediaMap);
  const contentJson = convertWordPressHtmlToTiptapJson(rewrittenHtml);
  const contentHtml = tiptapJsonToHtml(contentJson);
  const featuredImageUrl = post.featuredImageUrl ? mediaMap.get(post.featuredImageUrl) ?? post.featuredImageUrl : null;

  const existing = await findPostByExternalId(templateId, post.externalId);
  const savePayload = {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerptHtml ? post.excerptHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null,
    contentJson,
    contentHtml,
    featuredImageUrl,
    featuredImageAlt: post.featuredImageAlt,
    status: BlogPostStatus.PUBLISHED,
    authorId,
    categoryIds,
    tagIds,
    externalId: post.externalId,
    publishedAtOverride: post.dateIso,
  };

  const savedPost = existing
    ? await updateBlogPost(templateId, existing.id, savePayload)
    : await createBlogPost(templateId, savePayload);

  if (savedPost && post.link) {
    await createRedirectsForImportedPost(templateId, post.link, Number(post.externalId) || 0, savedPost.slug);
  }
}

async function runRestBatch(
  templateId: string,
  sourceUrl: string,
  cursor: RestCursor,
  errors: string[],
): Promise<{ processed: number; nextCursor: RestCursor; done: boolean; totalPosts: number }> {
  const { posts, totalPages, totalPosts } = await fetchWordPressPostsPage(sourceUrl, cursor.page, cursor.perPage);

  let processed = 0;
  for (const wpPost of posts) {
    if (wpPost.status !== "publish") continue; // drafts/private posts on the source site aren't migrated
    try {
      await importOnePost(
        templateId,
        {
          externalId: String(wpPost.id),
          title: wpPost.title || "Untitled",
          link: wpPost.link,
          contentHtml: wpPost.contentHtml,
          excerptHtml: wpPost.excerptHtml,
          dateIso: wpPost.dateGmt ? `${wpPost.dateGmt}Z` : null,
          slug: wpPost.slug,
          authorName: wpPost.author?.name ?? null,
          authorAvatarUrl: wpPost.author?.avatarUrl,
          categoryNames: wpPost.categories.map((c) => c.name),
          tagNames: wpPost.tags.map((t) => t.name),
          featuredImageUrl: wpPost.featuredMedia?.url ?? null,
          featuredImageAlt: wpPost.featuredMedia?.alt || null,
        },
        errors,
      );
      processed += 1;
    } catch (err) {
      errors.push(`"${wpPost.title}" failed to import: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const nextPage = cursor.page + 1;
  return { processed, nextCursor: { page: nextPage, perPage: cursor.perPage }, done: nextPage > totalPages, totalPosts };
}

async function runWxrBatch(
  templateId: string,
  wxrBlobUrl: string,
  cursor: WxrCursor,
  errors: string[],
): Promise<{ processed: number; nextCursor: WxrCursor; done: boolean; totalPosts: number }> {
  const res = await fetch(wxrBlobUrl);
  if (!res.ok) throw new Error(`Couldn't re-read the uploaded export file (${res.status}).`);
  const xml = await res.text();
  const parsed = parseWxr(xml);
  const authorByLogin = new Map(parsed.authors.map((a) => [a.login, a.displayName]));

  const batch = parsed.posts.slice(cursor.offset, cursor.offset + cursor.batchSize);
  let processed = 0;
  for (const wxrPost of batch) {
    try {
      await importOnePost(
        templateId,
        {
          externalId: wxrPost.postId,
          title: wxrPost.title,
          link: wxrPost.link,
          contentHtml: wxrPost.contentHtml,
          excerptHtml: wxrPost.excerptHtml,
          dateIso: wxrDateToIso(wxrPost.postDateGmt),
          slug: wxrPost.slug,
          authorName: authorByLogin.get(wxrPost.authorLogin) ?? wxrPost.authorLogin ?? null,
          categoryNames: wxrPost.categories.map((c) => c.name),
          tagNames: wxrPost.tags.map((t) => t.name),
          featuredImageUrl: wxrPost.featuredImageUrl,
          featuredImageAlt: null,
        },
        errors,
      );
      processed += 1;
    } catch (err) {
      errors.push(`"${wxrPost.title}" failed to import: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const nextOffset = cursor.offset + cursor.batchSize;
  return {
    processed,
    nextCursor: { offset: nextOffset, batchSize: cursor.batchSize },
    done: nextOffset >= parsed.posts.length,
    totalPosts: parsed.posts.length,
  };
}

/**
 * Processes exactly one bounded batch of an import job (from either source type) and
 * returns whether the job is now finished. Safe to call repeatedly/concurrently-adjacent
 * for the SAME job — every post is upserted by (templateId, externalId), so a retried
 * batch (e.g. the stalled-job cron re-triggering a chain that died mid-batch) never
 * duplicates posts; ImportMediaMap gives the same idempotency for re-downloaded media.
 */
export async function processImportBatch(jobId: string): Promise<{ done: boolean; status: ImportJobStatus }> {
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job) return { done: true, status: ImportJobStatus.CANCELLED };
  if (job.status === ImportJobStatus.COMPLETED || job.status === ImportJobStatus.CANCELLED || job.status === ImportJobStatus.FAILED) {
    return { done: true, status: job.status };
  }

  const errors = asErrorArray(job.errors);
  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: ImportJobStatus.RUNNING, lastHeartbeatAt: new Date(), startedAt: job.startedAt ?? new Date() },
  });

  try {
    let result: { processed: number; nextCursor: unknown; done: boolean; totalPosts: number };

    if (job.sourceType === ImportSourceType.WP_REST) {
      if (!job.sourceUrl) throw new Error("Missing source URL.");
      const cursor = (job.cursor as unknown as RestCursor) ?? { page: 1, perPage: POSTS_PER_BATCH };
      result = await runRestBatch(job.templateId, job.sourceUrl, cursor, errors);
    } else {
      if (!job.wxrBlobUrl) throw new Error("Missing uploaded export file.");
      const cursor = (job.cursor as unknown as WxrCursor) ?? { offset: 0, batchSize: POSTS_PER_BATCH };
      result = await runWxrBatch(job.templateId, job.wxrBlobUrl, cursor, errors);
    }

    const status = result.done ? ImportJobStatus.COMPLETED : ImportJobStatus.RUNNING;
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status,
        cursor: result.nextCursor as object,
        processedPosts: job.processedPosts + result.processed,
        totalPosts: job.totalPosts ?? result.totalPosts,
        lastHeartbeatAt: new Date(),
        finishedAt: result.done ? new Date() : null,
        errors,
      },
    });

    return { done: result.done, status };
  } catch (err) {
    errors.push(`Batch failed: ${err instanceof Error ? err.message : String(err)}`);
    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: ImportJobStatus.PAUSED_ERROR, errors, lastHeartbeatAt: new Date() },
    });
    return { done: false, status: ImportJobStatus.PAUSED_ERROR };
  }
}
