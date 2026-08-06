import { revalidatePath } from "next/cache";
import { prisma } from "@/server/prisma";

export interface RevalidateBlogPostInput {
  templateId: string;
  slug: string;
  categorySlugs: string[];
  tagSlugs: string[];
  authorSlug?: string | null;
  // Previous values on an edit — so a post removed from a category/tag/author still
  // invalidates the archive page it just disappeared from.
  previousCategorySlugs?: string[];
  previousTagSlugs?: string[];
  previousAuthorSlug?: string | null;
}

/**
 * Plain Prisma reads (not fetch-based) can't be revalidated by revalidateTag — but
 * everything a single post touches is fully enumerable from its own relations, so this
 * computes and invalidates all of it directly: the post itself, the listing's first
 * page, every category/tag/author archive it's in (or was just removed from), the RSS
 * feed, and the sitemap. A site can be reachable under more than one PublishedDomain
 * (e.g. mid-migration to a custom domain), so every domain gets invalidated. Called from
 * the editor's publish/save Server Action and after each WordPress-import batch.
 */
export async function revalidateBlogPost(input: RevalidateBlogPostInput): Promise<void> {
  const domains = await prisma.publishedDomain.findMany({
    where: { templateId: input.templateId },
    select: { domain: true },
  });

  const categorySlugs = new Set([...(input.categorySlugs ?? []), ...(input.previousCategorySlugs ?? [])]);
  const tagSlugs = new Set([...(input.tagSlugs ?? []), ...(input.previousTagSlugs ?? [])]);
  const authorSlugs = new Set([input.authorSlug, input.previousAuthorSlug].filter((v): v is string => Boolean(v)));

  for (const { domain } of domains) {
    const base = `/pub/${domain}/blog`;
    revalidatePath(base);
    revalidatePath(`${base}/${input.slug}`);
    revalidatePath(`${base}/feed.xml`);
    revalidatePath(`${base}/sitemap.xml`);
    for (const c of categorySlugs) revalidatePath(`${base}/category/${c}`);
    for (const t of tagSlugs) revalidatePath(`${base}/tag/${t}`);
    for (const a of authorSlugs) revalidatePath(`${base}/author/${a}`);
    // Pagination beyond page 1 is rare enough right after a single-post edit that a
    // stale ISR window (60s) there is an acceptable tradeoff vs. enumerating every page.
  }
}
