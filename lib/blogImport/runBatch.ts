import { BlogPostStatus, ImportJobStatus, ImportMediaHandling, ImportSourceType } from "@prisma/client";
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

// A batch's claim on a job (see processImportBatch) is released as soon as the batch
// finishes — this is only a backstop for an invocation that died without releasing it.
const STALE_LOCK_MS = 5 * 60 * 1000;

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

/** The shared work for one post, regardless of which source produced it: dedupe taxonomy/author, rehost media (if enabled), convert content, upsert, and write redirects. */
async function importOnePost(
  templateId: string,
  post: NormalizedImportPost,
  mediaHandling: ImportMediaHandling,
  errors: string[],
): Promise<void> {
  const [categoryIds, tagIds, authorId] = await Promise.all([
    Promise.all(post.categoryNames.map((name) => findOrCreateCategory(templateId, name))),
    Promise.all(post.tagNames.map((name) => findOrCreateTag(templateId, name))),
    post.authorName ? findOrCreateAuthor(templateId, post.authorName, post.authorAvatarUrl) : Promise.resolve(null),
  ]);

  const shortcodes = detectShortcodes(post.contentHtml);
  if (shortcodes.length > 0) {
    errors.push(`"${post.title}": removed unsupported shortcode(s) ${shortcodes.slice(0, 3).join(", ")} — please check this post.`);
  }

  // RETAIN keeps every <img src> and the featured image pointed at the source site — no
  // network calls, no Blob writes. REHOST downloads and re-uploads each image once.
  let rewrittenHtml = post.contentHtml;
  let featuredImageUrl = post.featuredImageUrl;
  if (mediaHandling === ImportMediaHandling.REHOST) {
    const imageUrls = [post.featuredImageUrl, ...extractImageUrls(post.contentHtml)].filter((u): u is string => Boolean(u));
    const mediaMap = await rehostMediaUrls(templateId, imageUrls, errors);
    rewrittenHtml = rewriteImageUrls(post.contentHtml, mediaMap);
    featuredImageUrl = post.featuredImageUrl ? mediaMap.get(post.featuredImageUrl) ?? post.featuredImageUrl : null;
  }
  const contentJson = convertWordPressHtmlToTiptapJson(rewrittenHtml);
  const contentHtml = tiptapJsonToHtml(contentJson);

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
  mediaHandling: ImportMediaHandling,
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
        mediaHandling,
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
  mediaHandling: ImportMediaHandling,
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
        mediaHandling,
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
 * batch never duplicates posts. Overlapping invocations (e.g. the stalled-job cron
 * re-triggering a chain that's actually still alive, just slow) are additionally guarded
 * by an atomic claim on `processing`: only one invocation can hold the job at a time, so
 * two invocations never race the same ImportMediaMap check / Vercel Blob upload for the
 * same cursor.
 */
export async function processImportBatch(jobId: string): Promise<{ done: boolean; status: ImportJobStatus }> {
  const existing = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!existing) return { done: true, status: ImportJobStatus.CANCELLED };
  if (existing.status === ImportJobStatus.COMPLETED || existing.status === ImportJobStatus.CANCELLED || existing.status === ImportJobStatus.FAILED) {
    return { done: true, status: existing.status };
  }

  const claim = await prisma.importJob.updateMany({
    where: {
      id: jobId,
      // Anything not already terminal (checked above) is claimable — this must mirror the
      // early-return terminal check, otherwise a status left out here (e.g. PAUSED_ERROR)
      // would silently become unclaimable forever, breaking both the stalled-job cron and
      // manual retry.
      status: { in: [ImportJobStatus.PENDING, ImportJobStatus.DISCOVERING, ImportJobStatus.RUNNING, ImportJobStatus.PAUSED_ERROR] },
      OR: [{ processing: false }, { lastHeartbeatAt: null }, { lastHeartbeatAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } }],
    },
    data: { processing: true, status: ImportJobStatus.RUNNING, lastHeartbeatAt: new Date(), startedAt: existing.startedAt ?? new Date() },
  });
  if (claim.count === 0) {
    // Either another invocation genuinely owns this job right now, or it just finished/was
    // cancelled between our two reads — either way, this invocation has nothing to do, and
    // reports itself "done" so callers don't schedule a redundant continuation on top of
    // whichever invocation actually holds the claim.
    const current = await prisma.importJob.findUnique({ where: { id: jobId } });
    return { done: true, status: current?.status ?? ImportJobStatus.CANCELLED };
  }

  const job = (await prisma.importJob.findUnique({ where: { id: jobId } }))!;
  const errors = asErrorArray(job.errors);

  try {
    let result: { processed: number; nextCursor: unknown; done: boolean; totalPosts: number };

    if (job.sourceType === ImportSourceType.WP_REST) {
      if (!job.sourceUrl) throw new Error("Missing source URL.");
      const cursor = (job.cursor as unknown as RestCursor) ?? { page: 1, perPage: POSTS_PER_BATCH };
      result = await runRestBatch(job.templateId, job.sourceUrl, cursor, job.mediaHandling, errors);
    } else {
      if (!job.wxrBlobUrl) throw new Error("Missing uploaded export file.");
      const cursor = (job.cursor as unknown as WxrCursor) ?? { offset: 0, batchSize: POSTS_PER_BATCH };
      result = await runWxrBatch(job.templateId, job.wxrBlobUrl, cursor, job.mediaHandling, errors);
    }

    const status = result.done ? ImportJobStatus.COMPLETED : ImportJobStatus.RUNNING;
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status,
        processing: false,
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
      data: { status: ImportJobStatus.PAUSED_ERROR, processing: false, errors, lastHeartbeatAt: new Date() },
    });
    return { done: false, status: ImportJobStatus.PAUSED_ERROR };
  }
}
