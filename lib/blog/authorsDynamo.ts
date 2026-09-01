import { randomUUID } from "node:crypto";
import { BlogAuthor } from "@/lib/db/contentEntities";
import { slugify, avoidPageReservedSlug } from "@/server/slugDynamo";

/** DynamoDB port of lib/blog/authors.ts's generateUniqueAuthorSlug — slug is BlogAuthor's
 * own sort key (see contentEntities.ts), so each candidate check is an O(1) .get(), not a scan. */
export async function generateUniqueAuthorSlug(templateId: string, name: string): Promise<string> {
  const baseSlug = avoidPageReservedSlug(slugify(name) || "author", "author");
  let slug = baseSlug;
  let suffix = 2;
  while ((await BlogAuthor.get({ templateId, slug }).go()).data) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

/** DynamoDB port of lib/blog/authors.ts's findOrCreateAuthorForUser — byUser GSI1's SK
 * includes templateId, so an exact (userId, templateId) lookup is a single indexed query,
 * not a scan-and-filter. */
export async function findOrCreateAuthorForUser(templateId: string, userId: string, name: string) {
  const { data: existing } = await BlogAuthor.query.byUser({ userId, templateId }).go();
  if (existing[0]) return existing[0];

  const slug = await generateUniqueAuthorSlug(templateId, name);
  const id = randomUUID();
  await BlogAuthor.create({ id, templateId, userId, name, slug }).go();
  const { data: created } = await BlogAuthor.get({ templateId, slug }).go();
  if (!created) throw new Error(`BlogAuthor ${id} vanished immediately after being created`);
  return created;
}
