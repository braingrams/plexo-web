import { ImportJob } from "@/lib/db/importEntities";
import { safeFetch } from "@/lib/siteImport/fetchSafe";
import { fetchWordPressPostsPage } from "./wpClient";
import { parseWxr, wxrDateToIso } from "./wxrParser";
import { findOrCreateCategory, findOrCreateTag, findOrCreateAuthor } from "./taxonomyDynamo";
import { rehostMediaUrls, extractImageUrls, rewriteImageUrls } from "./mediaRehostDynamo";
import { convertWordPressHtmlToTiptapJson, tiptapJsonToHtml, detectShortcodes } from "./htmlToTiptap";
import { createBlogPost, updateBlogPost, findPostByExternalId } from "@/lib/blog/savePostDynamo";
import { createRedirectsForImportedPost } from "./redirectsDynamo";

type MediaHandling = "RETAIN" | "REHOST";
type SourceType = "WP_REST" | "WXR_UPLOAD";
type JobStatus = "PENDING" | "DISCOVERING" | "RUNNING" | "PAUSED_ERROR" | "COMPLETED" | "FAILED" | "CANCELLED";

// DynamoDB port of lib/blogImport/runBatch.ts. See that file's own comments for the
// overall batch/cursor/media-handling design, unchanged here — only the persistence
// layer is different.

const POSTS_PER_BATCH = 5;
const STALE_LOCK_MS = 5 * 60 * 1000;

interface RestCursor {
  page: number;
  perPage: number;
}

interface WxrCursor {
  offset: number;
  batchSize: number;
}

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

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

async function importOnePost(
  templateId: string,
  post: NormalizedImportPost,
  mediaHandling: MediaHandling,
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

  let rewrittenHtml = post.contentHtml;
  let featuredImageUrl = post.featuredImageUrl;
  if (mediaHandling === "REHOST") {
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
    status: "PUBLISHED" as const,
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
  mediaHandling: MediaHandling,
  errors: string[],
): Promise<{ processed: number; nextCursor: RestCursor; done: boolean; totalPosts: number }> {
  const { posts, totalPages, totalPosts } = await fetchWordPressPostsPage(sourceUrl, cursor.page, cursor.perPage);

  let processed = 0;
  for (const wpPost of posts) {
    if (wpPost.status !== "publish") continue;
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
  mediaHandling: MediaHandling,
  errors: string[],
): Promise<{ processed: number; nextCursor: WxrCursor; done: boolean; totalPosts: number }> {
  const res = await safeFetch(wxrBlobUrl);
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
 * Processes exactly one bounded batch of an import job and returns whether it's now
 * finished. Unlike the Prisma version, this needs templateId up front — ImportJob's
 * primary key is (templateId, id) (see importEntities.ts), so there's no id-only lookup
 * to fall back on. Every real caller already has templateId in scope (the route's own
 * URL params, or the stalled-job cron's own ImportJob.byStatus query result), so this
 * isn't a new constraint on anything, just a signature that matches the real key shape.
 */
export async function processImportBatch(templateId: string, jobId: string): Promise<{ done: boolean; status: JobStatus }> {
  const { data: existing } = await ImportJob.get({ templateId, id: jobId }).go();
  if (!existing) return { done: true, status: "CANCELLED" };
  if (existing.status === "COMPLETED" || existing.status === "CANCELLED" || existing.status === "FAILED") {
    return { done: true, status: existing.status };
  }

  const now = new Date().toISOString();
  const staleThreshold = new Date(Date.now() - STALE_LOCK_MS).toISOString();

  // Atomic claim — mirrors the Prisma version's updateMany + count check exactly:
  // claimable if not already terminal (checked above) AND not currently held by another
  // live invocation (processing=false, or no heartbeat yet, or heartbeat stale).
  try {
    await ImportJob.patch({ templateId, id: jobId })
      .set({ processing: true, status: "RUNNING", lastHeartbeatAt: now, startedAt: existing.startedAt ?? now })
      .where(
        (attr, op) =>
          `(${op.eq(attr.status, "PENDING")} OR ${op.eq(attr.status, "DISCOVERING")} OR ${op.eq(attr.status, "RUNNING")} OR ${op.eq(attr.status, "PAUSED_ERROR")}) AND (${op.eq(attr.processing, false)} OR ${op.notExists(attr.lastHeartbeatAt)} OR ${op.lt(attr.lastHeartbeatAt, staleThreshold)})`,
      )
      .go();
  } catch (err) {
    if (!isConditionalCheckFailure(err)) throw err;
    // Either another invocation genuinely owns this job right now, or it just
    // finished/was cancelled between our two reads — either way, this invocation has
    // nothing to do, and reports itself "done" so callers don't schedule a redundant
    // continuation on top of whichever invocation actually holds the claim.
    const { data: current } = await ImportJob.get({ templateId, id: jobId }).go();
    return { done: true, status: current?.status ?? "CANCELLED" };
  }

  const { data: job } = await ImportJob.get({ templateId, id: jobId }).go();
  if (!job) return { done: true, status: "CANCELLED" };
  const errors = asErrorArray(job.errors);

  try {
    let result: { processed: number; nextCursor: unknown; done: boolean; totalPosts: number };

    if (job.sourceType === "WP_REST") {
      if (!job.sourceUrl) throw new Error("Missing source URL.");
      const cursor = (job.cursor as unknown as RestCursor) ?? { page: 1, perPage: POSTS_PER_BATCH };
      result = await runRestBatch(job.templateId, job.sourceUrl, cursor, job.mediaHandling ?? "RETAIN", errors);
    } else {
      if (!job.wxrBlobUrl) throw new Error("Missing uploaded export file.");
      const cursor = (job.cursor as unknown as WxrCursor) ?? { offset: 0, batchSize: POSTS_PER_BATCH };
      result = await runWxrBatch(job.templateId, job.wxrBlobUrl, cursor, job.mediaHandling ?? "RETAIN", errors);
    }

    const status: JobStatus = result.done ? "COMPLETED" : "RUNNING";
    let patch = ImportJob.patch({ templateId, id: jobId }).set({
      status,
      processing: false,
      cursor: result.nextCursor,
      processedPosts: (job.processedPosts ?? 0) + result.processed,
      totalPosts: job.totalPosts ?? result.totalPosts,
      lastHeartbeatAt: new Date().toISOString(),
      errors,
      ...(result.done ? { finishedAt: new Date().toISOString() } : {}),
    });
    if (!result.done) patch = patch.remove(["finishedAt"]);
    await patch.go();

    return { done: result.done, status };
  } catch (err) {
    errors.push(`Batch failed: ${err instanceof Error ? err.message : String(err)}`);
    await ImportJob.patch({ templateId, id: jobId })
      .set({ status: "PAUSED_ERROR", processing: false, errors, lastHeartbeatAt: new Date().toISOString() })
      .go();
    return { done: false, status: "PAUSED_ERROR" };
  }
}
