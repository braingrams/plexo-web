import { prisma } from "@/server/prisma";
import { slugify, avoidPageReservedSlug } from "@/server/slug";

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

/** Dedupes by case-insensitive name within the site — reruns/resumed batches never create duplicate categories/tags/authors. */
export async function findOrCreateCategory(templateId: string, name: string): Promise<string> {
  const existing = await prisma.blogCategory.findFirst({ where: { templateId, name: { equals: name, mode: "insensitive" } } });
  if (existing) return existing.id;
  const slug = await uniqueSlug((s) => prisma.blogCategory.findFirst({ where: { templateId, slug: s } }).then(Boolean), avoidPageReservedSlug(slugify(name) || "category", "category"));
  const created = await prisma.blogCategory.create({ data: { templateId, name, slug } });
  return created.id;
}

export async function findOrCreateTag(templateId: string, name: string): Promise<string> {
  const existing = await prisma.blogTag.findFirst({ where: { templateId, name: { equals: name, mode: "insensitive" } } });
  if (existing) return existing.id;
  const slug = await uniqueSlug((s) => prisma.blogTag.findFirst({ where: { templateId, slug: s } }).then(Boolean), avoidPageReservedSlug(slugify(name) || "tag", "tag"));
  const created = await prisma.blogTag.create({ data: { templateId, name, slug } });
  return created.id;
}

export async function findOrCreateAuthor(templateId: string, name: string, avatarUrl?: string | null): Promise<string> {
  const existing = await prisma.blogAuthor.findFirst({ where: { templateId, name: { equals: name, mode: "insensitive" } } });
  if (existing) return existing.id;
  const slug = await uniqueSlug((s) => prisma.blogAuthor.findFirst({ where: { templateId, slug: s } }).then(Boolean), avoidPageReservedSlug(slugify(name) || "author", "author"));
  const created = await prisma.blogAuthor.create({ data: { templateId, name, slug, avatarUrl: avatarUrl || null } });
  return created.id;
}
