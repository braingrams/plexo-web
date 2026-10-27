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
// slug, and none of these entities index name — the template's full list is read (every
// page of it: a big blog has thousands of tags) and filtered in memory. Lookups are
// remembered briefly, so importing thousands of posts doesn't re-read the list per post.

type Term = { id: string; slug: string };
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; byName: Map<string, Term> }>();
// Two posts copied at once that both introduce a new author/tag share one creation.
const inflight = new Map<string, Promise<Term>>();

function once(key: string, create: () => Promise<Term>): Promise<Term> {
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = create().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function knownTerms(
  kind: string,
  templateId: string,
  load: () => Promise<{ id: string; slug: string; name: string }[]>,
  name: string,
  stillExists: (slug: string) => Promise<boolean>,
): Promise<Map<string, Term>> {
  const key = `${kind}:${templateId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    // One cheap read confirms a remembered term wasn't deleted from the dashboard meanwhile.
    const remembered = hit.byName.get(name.toLowerCase());
    if (!remembered || (await stillExists(remembered.slug))) return hit.byName;
  }
  const byName = new Map((await load()).map((t) => [t.name.toLowerCase(), { id: t.id, slug: t.slug }]));
  cache.set(key, { at: Date.now(), byName });
  return byName;
}

export function ensureCategory(templateId: string, name: string): Promise<Term> {
  return once(`category:${templateId}:${name.toLowerCase()}`, () => createCategory(templateId, name));
}

async function createCategory(templateId: string, name: string): Promise<Term> {
  const known = await knownTerms("category", templateId, async () => (await BlogCategory.query.primary({ templateId }).go({ pages: "all" })).data, name, async (slug) => (await BlogCategory.get({ templateId, slug }).go()).data !== null);
  const existing = known.get(name.toLowerCase());
  if (existing) return existing;
  const slug = await uniqueSlug(
    async (s) => (await BlogCategory.get({ templateId, slug: s }).go()).data !== null,
    avoidPageReservedSlug(slugify(name) || "category", "category"),
  );
  const id = randomUUID();
  await BlogCategory.create({ id, templateId, name, slug }).go();
  known.set(name.toLowerCase(), { id, slug });
  return { id, slug };
}

export function ensureTag(templateId: string, name: string): Promise<Term> {
  return once(`tag:${templateId}:${name.toLowerCase()}`, () => createTag(templateId, name));
}

async function createTag(templateId: string, name: string): Promise<Term> {
  const known = await knownTerms("tag", templateId, async () => (await BlogTag.query.primary({ templateId }).go({ pages: "all" })).data, name, async (slug) => (await BlogTag.get({ templateId, slug }).go()).data !== null);
  const existing = known.get(name.toLowerCase());
  if (existing) return existing;
  const slug = await uniqueSlug(
    async (s) => (await BlogTag.get({ templateId, slug: s }).go()).data !== null,
    avoidPageReservedSlug(slugify(name) || "tag", "tag"),
  );
  const id = randomUUID();
  await BlogTag.create({ id, templateId, name, slug }).go();
  known.set(name.toLowerCase(), { id, slug });
  return { id, slug };
}

export async function findOrCreateCategory(templateId: string, name: string): Promise<string> {
  return (await ensureCategory(templateId, name)).id;
}

export async function findOrCreateTag(templateId: string, name: string): Promise<string> {
  return (await ensureTag(templateId, name)).id;
}

export async function findOrCreateAuthor(templateId: string, name: string, avatarUrl?: string | null): Promise<string> {
  return (await once(`author:${templateId}:${name.toLowerCase()}`, () => createAuthor(templateId, name, avatarUrl))).id;
}

async function createAuthor(templateId: string, name: string, avatarUrl?: string | null): Promise<Term> {
  const known = await knownTerms("author", templateId, async () => (await BlogAuthor.query.primary({ templateId }).go({ pages: "all" })).data, name, async (slug) => (await BlogAuthor.get({ templateId, slug }).go()).data !== null);
  const existing = known.get(name.toLowerCase());
  if (existing) return existing;
  const slug = await uniqueSlug(
    async (s) => (await BlogAuthor.get({ templateId, slug: s }).go()).data !== null,
    avoidPageReservedSlug(slugify(name) || "author", "author"),
  );
  const id = randomUUID();
  await BlogAuthor.create({ id, templateId, name, slug, avatarUrl: avatarUrl || undefined }).go();
  known.set(name.toLowerCase(), { id, slug });
  return { id, slug };
}
