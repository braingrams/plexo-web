import { prisma } from "@/server/prisma";

const SLUG_SEGMENT_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guards page-tree routes against a malformed id (e.g. a caller bug that
 * passes "undefined" as a literal string) reaching Prisma as a raw query
 * param — Postgres rejects a non-UUID string against a `@db.Uuid` column
 * with a syntax error that isn't a normal "not found" case, so left
 * unchecked it surfaces as an opaque 500 instead of a clean 404/400. AI/MCP
 * callers are exactly the kind of client most likely to hit this from a
 * client-side bug, so the error should be actionable rather than a crash.
 */
export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Normalizes free text (a page's friendly name, or a user-typed slug) into a
 * single URL path segment: lowercase, alphanumeric + hyphens, no leading/
 * trailing/duplicate hyphens. Used for both auto-slugifying a new page's
 * name and validating a manually-edited slug.
 */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function isValidSlugSegment(slug: string): boolean {
  return SLUG_SEGMENT_REGEX.test(slug);
}

/**
 * Appends -2, -3, ... to `base` until it no longer collides with a sibling
 * under `parentId` for this user's page tree (the DB's @@unique([parentId,
 * slug]) is the source of truth; this just avoids a guaranteed-to-fail
 * first attempt so page creation "just works" for non-technical users
 * typing duplicate names like "About" twice).
 */
export async function ensureUniqueSlug(parentId: string, baseSlugInput: string): Promise<string> {
  const base = slugify(baseSlugInput) || "page";
  let candidate = base;
  let suffix = 2;
  // Small page trees in practice — a handful of round trips is fine.
  while (
    await prisma.template.findFirst({
      where: { parentId, slug: candidate },
      select: { id: true },
    })
  ) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/**
 * True if `candidateAncestorId` is `startId` itself or one of its ancestors
 * (walking up the parentId chain). Used to reject a re-parent move that
 * would nest a page underneath its own descendant, which would otherwise
 * create a cycle in the page tree. Shared by the REST PATCH route and the
 * MCP update_landing_page_page tool.
 */
export async function isSameOrAncestor(startId: string, candidateAncestorId: string): Promise<boolean> {
  let currentId: string | null = startId;
  while (currentId) {
    if (currentId === candidateAncestorId) return true;
    const current: { parentId: string | null } | null = await prisma.template.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    currentId = current?.parentId ?? null;
  }
  return false;
}

export interface PageTreeNode {
  id: string;
  name: string;
  slug: string | null;
  parentId: string | null;
  order: number;
  updatedAt: Date;
}

/**
 * Resolves the whole page tree (root + every descendant, breadth-first)
 * that `anyPageId` belongs to, regardless of whether it's the root itself or
 * nested somewhere inside it. Shared by the REST pages-tree route and the
 * MCP get_landing_page_pages tool. Returns null if `anyPageId` doesn't
 * belong to `userId`.
 */
export async function getPageTree(userId: string, anyPageId: string): Promise<{ rootId: string; pages: PageTreeNode[] } | null> {
  if (!isValidUuid(anyPageId)) return null;
  const current = await prisma.template.findFirst({
    where: { id: anyPageId, userId },
    select: { id: true, parentId: true },
  });
  if (!current) return null;

  let rootId = current.id;
  let walkParentId = current.parentId;
  while (walkParentId) {
    const parent = await prisma.template.findFirst({
      where: { id: walkParentId, userId },
      select: { id: true, parentId: true },
    });
    if (!parent) break;
    rootId = parent.id;
    walkParentId = parent.parentId;
  }

  const root = await prisma.template.findFirst({
    where: { id: rootId, userId },
    select: { id: true, name: true, slug: true, parentId: true, order: true, updatedAt: true },
  });
  if (!root) return null;

  const pages: PageTreeNode[] = [root];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await prisma.template.findMany({
      where: { parentId: { in: frontier }, userId },
      orderBy: { order: "asc" },
      select: { id: true, name: true, slug: true, parentId: true, order: true, updatedAt: true },
    });
    pages.push(...children);
    frontier = children.map((c) => c.id);
  }

  return { rootId, pages };
}

/** Full resolved path ("/blog/post-1") for a page within an already-fetched tree. */
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

/** Every descendant id under `pageId` (not including `pageId` itself), for delete-confirmation counts. */
export async function getDescendantIds(userId: string, pageId: string): Promise<string[]> {
  const result: string[] = [];
  let frontier = [pageId];
  while (frontier.length > 0) {
    const children = await prisma.template.findMany({
      where: { parentId: { in: frontier }, userId },
      select: { id: true },
    });
    result.push(...children.map((c) => c.id));
    frontier = children.map((c) => c.id);
  }
  return result;
}
