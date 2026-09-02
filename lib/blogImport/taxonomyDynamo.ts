import { randomUUID } from "node:crypto";
import { BlogCategory, BlogTag, BlogAuthor } from "@/lib/db/contentEntities";
import { slugify, avoidPageReservedSlug } from "@/server/slugDynamo";

async function uniqueSlug(existsCheck: (candidate: string) => Promise<boolean>, base: string): Promise<string> {
  const baseSlug = slugify(base) || "item";
  let candidate = baseSlug;
  let suffix = 2;
  while (await existsCheck(candidate)) {
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

// DynamoDB port of lib/blogImport/taxonomy.ts. Dedup is by case-insensitive NAME, not
// slug, and none of these entities index name — each fetches the template's full
// category/tag/author list and filters in memory (small in practice, same bound used
// throughout this migration).

export async function findOrCreateCategory(templateId: string, name: string): Promise<string> {
  const { data: categories } = await BlogCategory.query.primary({ templateId }).go();
  const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const slug = await uniqueSlug(
    async (s) => (await BlogCategory.get({ templateId, slug: s }).go()).data !== null,
    avoidPageReservedSlug(slugify(name) || "category", "category"),
  );
  const id = randomUUID();
  await BlogCategory.create({ id, templateId, name, slug }).go();
  return id;
}

export async function findOrCreateTag(templateId: string, name: string): Promise<string> {
  const { data: tags } = await BlogTag.query.primary({ templateId }).go();
  const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const slug = await uniqueSlug(
    async (s) => (await BlogTag.get({ templateId, slug: s }).go()).data !== null,
    avoidPageReservedSlug(slugify(name) || "tag", "tag"),
  );
  const id = randomUUID();
  await BlogTag.create({ id, templateId, name, slug }).go();
  return id;
}

export async function findOrCreateAuthor(templateId: string, name: string, avatarUrl?: string | null): Promise<string> {
  const { data: authors } = await BlogAuthor.query.primary({ templateId }).go();
  const existing = authors.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const slug = await uniqueSlug(
    async (s) => (await BlogAuthor.get({ templateId, slug: s }).go()).data !== null,
    avoidPageReservedSlug(slugify(name) || "author", "author"),
  );
  const id = randomUUID();
  await BlogAuthor.create({ id, templateId, name, slug, avatarUrl: avatarUrl || undefined }).go();
  return id;
}
