import { revalidatePath } from "next/cache";
import { PublishedDomain } from "@/lib/db/contentEntities";

export interface RevalidateBlogPostInput {
  templateId: string;
  slug: string;
  categorySlugs: string[];
  tagSlugs: string[];
  authorSlug?: string | null;
  previousCategorySlugs?: string[];
  previousTagSlugs?: string[];
  previousAuthorSlug?: string | null;
}

/** DynamoDB port of lib/blog/revalidate.ts's revalidateBlogPost — same behavior (see
 * that file's comment), PublishedDomain query swapped for its own primary index. */
export async function revalidateBlogPost(input: RevalidateBlogPostInput): Promise<void> {
  const { data: domains } = await PublishedDomain.query.primary({ templateId: input.templateId }).go();

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
  }
}
