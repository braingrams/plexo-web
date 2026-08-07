import { prisma } from "@/server/prisma";
import { slugify, avoidPageReservedSlug } from "@/server/slug";

/** Dedup-suffixed slug for a new BlogAuthor on this template — shared by every creation path
 * (the authors API route, WordPress import's findOrCreateAuthor, and the current-user default
 * below) so they can't drift into different slugging rules. */
export async function generateUniqueAuthorSlug(templateId: string, name: string): Promise<string> {
  const baseSlug = avoidPageReservedSlug(slugify(name) || "author", "author");
  let slug = baseSlug;
  let suffix = 2;
  while (
    await prisma.blogAuthor.findFirst({ where: { templateId, slug }, select: { id: true } })
  ) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

/** The post editor's default author — one BlogAuthor per (templateId, userId), created the
 * first time a signed-in user opens the editor for a site with no author linked to them yet. */
export async function findOrCreateAuthorForUser(templateId: string, userId: string, name: string) {
  const existing = await prisma.blogAuthor.findFirst({ where: { templateId, userId } });
  if (existing) return existing;

  const slug = await generateUniqueAuthorSlug(templateId, name);
  return prisma.blogAuthor.create({
    data: { templateId, userId, name, slug },
  });
}
