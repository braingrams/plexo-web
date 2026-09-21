import { randomUUID } from "node:crypto";
import type { EntityItem } from "electrodb";
import { BlogPost, BlogPostCategory, BlogPostTag, BlogAuthor, BlogCategory, BlogTag } from "@/lib/db/contentEntities";
import { ensureUniqueBlogSlug } from "@/server/slugDynamo";
import { sanitizeBlogHtml } from "./sanitize";
import { estimateReadingTimeMinutes, autoExcerpt } from "./content";
import type { RevalidateBlogPostInput } from "./revalidateDynamo";

// Split out of lib/blog/savePostDynamo.ts so the actual DynamoDB mutation logic has NO
// `next/cache` import anywhere in its own module or its import graph — savePostDynamo.ts
// itself imports revalidateBlogPost (lib/blog/revalidateDynamo.ts), which calls Next.js's
// `revalidatePath` from "next/cache". Unlike the next/server-in-a-typeof-position cases
// elsewhere in this migration, next/cache's own import graph transitively requires
// "@opentelemetry/api" REGARDLESS of whether revalidatePath is ever actually called — even a
// dynamic `import("next/cache")` inside a function body still gets eagerly resolved and
// inlined by esbuild for a single-output CJS bundle (confirmed empirically), so there's no
// way to keep a static or dynamic reference to next/cache anywhere in a file reachable from
// lambda/sol-chat/index.ts's standalone esbuild bundle (see cdk/lib/compute-stack.ts's
// SolChatFn) without breaking that bundle.
//
// lib/mcp/blogTools.ts (reachable from SOL's Lambda via lib/ai/solAgent.ts ->
// lib/mcp/dispatchMcpTool.ts) needs createBlogPost/updateBlogPost/deleteBlogPost's actual
// DynamoDB read/write logic, so this file takes the revalidation step as an injected
// `revalidate` callback instead of importing revalidateBlogPost directly — the real
// revalidateBlogPost is only ever referenced (and next/cache only ever imported) from
// savePostDynamo.ts, which every EXISTING production call site (app/api/blog/**,
// lib/siteImport/**, lib/blogImport/**) still imports createBlogPost/updateBlogPost/
// deleteBlogPost from, completely unchanged — savePostDynamo.ts's wrapper binds the real
// revalidateBlogPost as this callback, so those callers see 100% identical behavior to
// before this split. blogTools.ts (the only caller reached from a bare Lambda with no
// Next.js page cache to invalidate in the first place) passes a no-op revalidate instead —
// see that file's own import comment.

export type RevalidateFn = (input: RevalidateBlogPostInput) => Promise<void>;

type BlogPostItem = EntityItem<typeof BlogPost>;
type PostStatus = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";

// Same helper as lib/db/{commerceOperations,commerceWebhookOperations,ledgerOperations}.ts
// — each keeps its own local copy rather than a shared import, matching that established
// convention.
function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

export interface SavePostInput {
  title: string;
  slug?: string | null;
  excerpt?: string | null;
  contentJson: unknown;
  contentHtml: string;
  featuredImageUrl?: string | null;
  featuredImageAlt?: string | null;
  status: PostStatus;
  scheduledAt?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  ogImageUrl?: string | null;
  noindex?: boolean;
  authorId?: string | null;
  categoryIds?: string[];
  tagIds?: string[];
  externalId?: string | null;
  publishedAtOverride?: string | null;
}

// DynamoDB-stack port of lib/blog/savePost.ts. BlogPost's primary key is
// (templateId, slug), not (templateId, id) — see contentEntities.ts — so every operation
// here that's handed a bare `postId` (all of them; that's the API these callers share
// with the Prisma version) has to resolve it to a slug first via the template's post list,
// same "small in practice" fetch-and-find-in-memory pattern used throughout this
// migration for entities with no id-based index.

function computePublishedAt(
  status: PostStatus,
  scheduledAt: Date | null,
  existingPublishedAt: string | null,
  override?: Date | null,
): string | null {
  if (override) return override.toISOString();
  if (status === "PUBLISHED") return existingPublishedAt ?? new Date().toISOString();
  if (status === "SCHEDULED") return scheduledAt?.toISOString() ?? existingPublishedAt ?? new Date().toISOString();
  return existingPublishedAt;
}

async function findPostById(templateId: string, postId: string): Promise<BlogPostItem | null> {
  const { data: posts } = await BlogPost.query.byStatus({ templateId }).go();
  return posts.find((p) => p.id === postId) ?? null;
}

async function syncCategoriesAndTags(templateId: string, postId: string, categoryIds: string[] | undefined, tagIds: string[] | undefined): Promise<void> {
  if (categoryIds !== undefined) {
    const { data: existing } = await BlogPostCategory.query.primary({ templateId, postId }).go();
    await Promise.all(existing.map((e) => BlogPostCategory.remove({ templateId, postId: e.postId, categoryId: e.categoryId }).go()));
    await Promise.all(
      categoryIds.map((categoryId) =>
        BlogPostCategory.create({ templateId, postId, categoryId })
          .go()
          .catch((err) => {
            if (!isConditionalCheckFailure(err)) throw err; // skipDuplicates equivalent — only swallow the "already exists" case
          }),
      ),
    );
  }
  if (tagIds !== undefined) {
    const { data: existing } = await BlogPostTag.query.primary({ templateId, postId }).go();
    await Promise.all(existing.map((e) => BlogPostTag.remove({ templateId, postId: e.postId, tagId: e.tagId }).go()));
    await Promise.all(
      tagIds.map((tagId) =>
        BlogPostTag.create({ templateId, postId, tagId })
          .go()
          .catch((err) => {
            if (!isConditionalCheckFailure(err)) throw err;
          }),
      ),
    );
  }
}

async function slugsForRevalidate(templateId: string, postId: string, authorId: string | null | undefined): Promise<{ categorySlugs: string[]; tagSlugs: string[]; authorSlug: string | null }> {
  const [{ data: postCategories }, { data: postTags }, { data: categories }, { data: tags }, authorResult] = await Promise.all([
    BlogPostCategory.query.primary({ templateId, postId }).go(),
    BlogPostTag.query.primary({ templateId, postId }).go(),
    BlogCategory.query.primary({ templateId }).go(),
    BlogTag.query.primary({ templateId }).go(),
    authorId ? BlogAuthor.query.primary({ templateId }).go() : null,
  ]);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const author = authorId && authorResult ? authorResult.data.find((a) => a.id === authorId) : null;

  return {
    categorySlugs: postCategories.map((pc) => categoryById.get(pc.categoryId)?.slug).filter((s): s is string => !!s),
    tagSlugs: postTags.map((pt) => tagById.get(pt.tagId)?.slug).filter((s): s is string => !!s),
    authorSlug: author?.slug ?? null,
  };
}

/** Upsert key for the WordPress importer. No externalId index (documented gap, same as
 * the Prisma-era Phase 4 roadmap already noted) — fetches the template's posts and
 * filters in memory, bounded by the same partition query every other per-template lookup
 * here uses, not a table-wide Scan. */
export async function findPostByExternalId(templateId: string, externalId: string): Promise<BlogPostItem | null> {
  const { data: posts } = await BlogPost.query.byStatus({ templateId }).go();
  return posts.find((p) => p.externalId === externalId) ?? null;
}

export async function createBlogPost(templateId: string, input: SavePostInput, revalidate: RevalidateFn): Promise<BlogPostItem> {
  const contentHtml = sanitizeBlogHtml(input.contentHtml);
  const slug = await ensureUniqueBlogSlug(templateId, input.slug?.trim() || input.title);
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  const publishedAt = computePublishedAt(input.status, scheduledAt, null, input.publishedAtOverride ? new Date(input.publishedAtOverride) : null);

  const id = randomUUID();
  await BlogPost.create({
    id,
    templateId,
    title: input.title.trim(),
    slug,
    excerpt: input.excerpt?.trim() || autoExcerpt(contentHtml),
    contentJson: input.contentJson,
    contentHtml,
    featuredImageUrl: input.featuredImageUrl || undefined,
    featuredImageAlt: input.featuredImageAlt || undefined,
    status: input.status,
    scheduledAt: scheduledAt?.toISOString(),
    publishedAt: publishedAt ?? undefined,
    metaTitle: input.metaTitle || undefined,
    metaDescription: input.metaDescription || undefined,
    ogImageUrl: input.ogImageUrl || undefined,
    noindex: input.noindex ?? false,
    readingTimeMinutes: estimateReadingTimeMinutes(input.contentJson),
    authorId: input.authorId || undefined,
    externalId: input.externalId || undefined,
  }).go();
  const { data: post } = await BlogPost.get({ templateId, slug }).go();
  if (!post) throw new Error(`BlogPost ${id} vanished immediately after being created`);

  await syncCategoriesAndTags(templateId, post.id, input.categoryIds, input.tagIds);
  const { categorySlugs, tagSlugs, authorSlug } = await slugsForRevalidate(templateId, post.id, post.authorId);
  await revalidate({ templateId, slug: post.slug, categorySlugs, tagSlugs, authorSlug });

  return post;
}

export async function updateBlogPost(templateId: string, postId: string, input: Partial<SavePostInput>, revalidate: RevalidateFn): Promise<BlogPostItem | null> {
  const existing = await findPostById(templateId, postId);
  if (!existing) return null;

  const { categorySlugs: previousCategorySlugs, tagSlugs: previousTagSlugs, authorSlug: previousAuthorSlug } = await slugsForRevalidate(
    templateId,
    existing.id,
    existing.authorId,
  );
  const previousSlug = existing.slug;

  const data: Record<string, unknown> = {};
  type RemovableField =
    | "featuredImageUrl"
    | "featuredImageAlt"
    | "metaTitle"
    | "metaDescription"
    | "ogImageUrl"
    | "authorId"
    | "scheduledAt"
    | "publishedAt";
  const toRemove: RemovableField[] = [];

  if (input.title !== undefined) data.title = input.title.trim();

  let nextSlug = existing.slug;
  if (input.slug !== undefined && input.slug !== null && input.slug.trim() && input.slug.trim() !== existing.slug) {
    // NOT added to `data` — slug is this entity's own sort-key attribute (see
    // contentEntities.ts), and ElectroDB can't .set() a key-composite attribute in
    // place. The rename itself happens below via an explicit create-at-new-key +
    // remove-old-key pair, after every other field change has already been applied at
    // the current key.
    nextSlug = await ensureUniqueBlogSlug(templateId, input.slug.trim());
  }

  let contentHtml = existing.contentHtml;
  if (input.contentHtml !== undefined) {
    contentHtml = sanitizeBlogHtml(input.contentHtml);
    data.contentHtml = contentHtml;
  }
  if (input.contentJson !== undefined) {
    data.contentJson = input.contentJson;
    data.readingTimeMinutes = estimateReadingTimeMinutes(input.contentJson);
  }
  if (input.excerpt !== undefined) data.excerpt = input.excerpt?.trim() || autoExcerpt(contentHtml);
  if (input.featuredImageUrl !== undefined) {
    if (input.featuredImageUrl) data.featuredImageUrl = input.featuredImageUrl;
    else toRemove.push("featuredImageUrl");
  }
  if (input.featuredImageAlt !== undefined) {
    if (input.featuredImageAlt) data.featuredImageAlt = input.featuredImageAlt;
    else toRemove.push("featuredImageAlt");
  }
  if (input.metaTitle !== undefined) {
    if (input.metaTitle) data.metaTitle = input.metaTitle;
    else toRemove.push("metaTitle");
  }
  if (input.metaDescription !== undefined) {
    if (input.metaDescription) data.metaDescription = input.metaDescription;
    else toRemove.push("metaDescription");
  }
  if (input.ogImageUrl !== undefined) {
    if (input.ogImageUrl) data.ogImageUrl = input.ogImageUrl;
    else toRemove.push("ogImageUrl");
  }
  if (input.noindex !== undefined) data.noindex = input.noindex;
  if (input.authorId !== undefined) {
    if (input.authorId) data.authorId = input.authorId;
    else toRemove.push("authorId");
  }

  if (input.status !== undefined) {
    const scheduledAt = input.scheduledAt !== undefined ? (input.scheduledAt ? new Date(input.scheduledAt) : null) : existing.scheduledAt ? new Date(existing.scheduledAt) : null;
    data.status = input.status;
    if (scheduledAt) data.scheduledAt = scheduledAt.toISOString();
    else toRemove.push("scheduledAt");
    const publishedAt = computePublishedAt(input.status, scheduledAt, existing.publishedAt ?? null);
    if (publishedAt) data.publishedAt = publishedAt;
    else toRemove.push("publishedAt");
  } else if (input.scheduledAt !== undefined) {
    if (input.scheduledAt) data.scheduledAt = new Date(input.scheduledAt).toISOString();
    else toRemove.push("scheduledAt");
  }

  let patch = BlogPost.patch({ templateId, slug: existing.slug }).set(data);
  if (toRemove.length) patch = patch.remove(toRemove);
  await patch.go();

  // A slug change means the item's SK itself changed — ElectroDB's patch updates the
  // existing item in place (slug isn't actually mutable via .set on its own key
  // attribute in a way that moves the item), so a real slug change needs an explicit
  // create-at-new-key + remove-old-key pair.
  let finalSlug = existing.slug;
  if (nextSlug !== existing.slug) {
    const { data: updated } = await BlogPost.get({ templateId, slug: existing.slug }).go();
    if (updated) {
      await BlogPost.create({ ...updated, slug: nextSlug }).go();
      await BlogPost.remove({ templateId, slug: existing.slug }).go();
      finalSlug = nextSlug;
    }
  }

  await syncCategoriesAndTags(templateId, existing.id, input.categoryIds, input.tagIds);

  const { data: post } = await BlogPost.get({ templateId, slug: finalSlug }).go();
  if (!post) throw new Error(`BlogPost ${postId} vanished immediately after being updated`);

  const { categorySlugs, tagSlugs, authorSlug } = await slugsForRevalidate(templateId, post.id, post.authorId);
  await revalidate({
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
    await revalidate({ templateId, slug: previousSlug, categorySlugs: [], tagSlugs: [], authorSlug: null });
  }

  return post;
}

export async function deleteBlogPost(templateId: string, postId: string, revalidate: RevalidateFn): Promise<boolean> {
  const existing = await findPostById(templateId, postId);
  if (!existing) return false;

  const { categorySlugs, tagSlugs, authorSlug } = await slugsForRevalidate(templateId, existing.id, existing.authorId);

  await BlogPost.remove({ templateId, slug: existing.slug }).go();
  await syncCategoriesAndTags(templateId, existing.id, [], []);

  await revalidate({
    templateId,
    slug: existing.slug,
    categorySlugs: [],
    tagSlugs: [],
    authorSlug: null,
    previousCategorySlugs: categorySlugs,
    previousTagSlugs: tagSlugs,
    previousAuthorSlug: authorSlug,
  });
  return true;
}
