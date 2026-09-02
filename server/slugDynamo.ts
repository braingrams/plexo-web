import { Template, BlogPost } from "@/lib/db/contentEntities";
import { slugify, isValidUuid } from "@/lib/slugUtils";

// DynamoDB-stack port of the old server/slug.ts (now deleted) — same behavior, same
// rationale on every function, just backed by Template/BlogPost queries instead of
// Prisma. isValidUuid/slugify/isValidSlugSegment/avoidPageReservedSlug are pure and
// unchanged (re-exported from lib/slugUtils.ts rather than duplicated).
export { isValidUuid, slugify, isValidSlugSegment, avoidPageReservedSlug } from "@/lib/slugUtils";

const RESERVED_TOP_LEVEL_PAGE_SLUGS = new Set(["blog"]);

async function parentIsSiteRoot(parentId: string): Promise<boolean> {
  const { data: parent } = await Template.get({ id: parentId }).go();
  return parent !== null && !parent?.parentId;
}

export async function isReservedTopLevelSlug(parentId: string, slug: string): Promise<boolean> {
  return RESERVED_TOP_LEVEL_PAGE_SLUGS.has(slug) && (await parentIsSiteRoot(parentId));
}

/**
 * Same as the Prisma version: appends -2, -3, ... until no sibling under parentId has
 * this slug. byParent (GSI2) returns every child of parentId — small page trees in
 * practice (same assumption the original made), so filtering in memory for an exact
 * slug match is fine; there's no indexed exact-match-on-slug within a parent to reach
 * for instead.
 */
export async function ensureUniqueSlug(parentId: string, baseSlugInput: string): Promise<string> {
  const base = slugify(baseSlugInput) || "page";
  const startReserved = RESERVED_TOP_LEVEL_PAGE_SLUGS.has(base) && (await parentIsSiteRoot(parentId));
  let candidate = startReserved ? `${base}-2` : base;
  let suffix = startReserved ? 3 : 2;

  const { data: siblings } = await Template.query.byParent({ parentId }).go();
  const siblingSlugs = new Set(siblings.map((s) => s.slug));
  while (siblingSlugs.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

const RESERVED_BLOG_POST_SLUGS = new Set(["category", "tag", "author", "page", "feed", "rss"]);

/** slug is BlogPost's own sort key (see contentEntities.ts) — an O(1) existence check
 * per candidate, not a scan. */
export async function ensureUniqueBlogSlug(templateId: string, baseSlugInput: string): Promise<string> {
  const rawBase = slugify(baseSlugInput) || "post";
  const base = RESERVED_BLOG_POST_SLUGS.has(rawBase) ? `${rawBase}-post` : rawBase;
  let candidate = base;
  let suffix = 2;
  while ((await BlogPost.get({ templateId, slug: candidate }).go()).data) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function getParentId(id: string): Promise<string | null> {
  const { data } = await Template.get({ id }).go();
  return data?.parentId ?? null;
}

export async function isSameOrAncestor(startId: string, candidateAncestorId: string): Promise<boolean> {
  let currentId: string | null = startId;
  while (currentId) {
    if (currentId === candidateAncestorId) return true;
    currentId = await getParentId(currentId);
  }
  return false;
}

export interface PageTreeNode {
  id: string;
  name: string;
  slug: string | null;
  parentId: string | null;
  order: number;
  updatedAt: string;
  sourceType: "BUILDER" | "RAW_UPLOAD";
}

function toNode(t: {
  id: string;
  name: string;
  slug?: string;
  parentId?: string;
  order?: number;
  updatedAt?: string;
  sourceType?: "BUILDER" | "RAW_UPLOAD";
}): PageTreeNode {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug ?? null,
    parentId: t.parentId ?? null,
    order: t.order ?? 0,
    updatedAt: t.updatedAt ?? new Date().toISOString(),
    sourceType: t.sourceType ?? "BUILDER",
  };
}

export async function getPageTree(organizationId: string, anyPageId: string): Promise<{ rootId: string; pages: PageTreeNode[] } | null> {
  if (!isValidUuid(anyPageId)) return null;
  const { data: current } = await Template.get({ id: anyPageId }).go();
  if (!current || current.organizationId !== organizationId) return null;

  let rootId = current.id;
  let walkParentId = current.parentId ?? null;
  while (walkParentId) {
    const { data: parent } = await Template.get({ id: walkParentId }).go();
    if (!parent || parent.organizationId !== organizationId) break;
    rootId = parent.id;
    walkParentId = parent.parentId ?? null;
  }

  const { data: root } = await Template.get({ id: rootId }).go();
  if (!root || root.organizationId !== organizationId) return null;

  const pages: PageTreeNode[] = [toNode(root)];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const childBatches = await Promise.all(frontier.map((parentId) => Template.query.byParent({ parentId }).go()));
    const children = childBatches.flatMap((b) => b.data).filter((c) => c.organizationId === organizationId);
    pages.push(...children.map(toNode));
    frontier = children.map((c) => c.id);
  }

  return { rootId, pages };
}

export function pathForPage(pageId: string, pages: PageTreeNode[]): string {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const segments: string[] = [];
  let cursor = byId.get(pageId);
  while (cursor && cursor.parentId) {
    if (cursor.slug) segments.unshift(cursor.slug);
    cursor = byId.get(cursor.parentId);
  }
  return "/" + segments.join("/");
}

export async function getDescendantIds(organizationId: string, pageId: string): Promise<string[]> {
  const result: string[] = [];
  let frontier = [pageId];
  while (frontier.length > 0) {
    const childBatches = await Promise.all(frontier.map((parentId) => Template.query.byParent({ parentId }).go()));
    const children = childBatches.flatMap((b) => b.data).filter((c) => c.organizationId === organizationId);
    result.push(...children.map((c) => c.id));
    frontier = children.map((c) => c.id);
  }
  return result;
}
