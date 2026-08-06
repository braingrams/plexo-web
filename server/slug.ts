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
 * "blog" is served by literal Next.js routes at the top level of every site
 * (app/pub/[domain]/blog/**), which always take precedence over a same-named Template
 * page one level below a site's root — such a page would be silently unreachable.
 * Pages nested deeper (e.g. /about/blog) don't collide with anything, so this only
 * matters for a page whose PARENT is itself a root (home) page.
 */
const RESERVED_TOP_LEVEL_PAGE_SLUGS = new Set(["blog"]);

async function parentIsSiteRoot(parentId: string): Promise<boolean> {
  const parent = await prisma.template.findUnique({ where: { id: parentId }, select: { parentId: true } });
  return parent !== null && parent.parentId === null;
}

/** Used by the page-rename API, which sets an explicit slug rather than auto-suffixing it. */
export async function isReservedTopLevelSlug(parentId: string, slug: string): Promise<boolean> {
  return RESERVED_TOP_LEVEL_PAGE_SLUGS.has(slug) && (await parentIsSiteRoot(parentId));
}

/**
 * Appends -2, -3, ... to `base` until it no longer collides with a sibling
 * under `parentId` for this user's page tree (the DB's @@unique([parentId,
 * slug]) is the source of truth; this just avoids a guaranteed-to-fail
 * first attempt so page creation "just works" for non-technical users
 * typing duplicate names like "About" twice). Also treats a reserved
 * top-level slug (see isReservedTopLevelSlug) as a phantom collision, so
 * e.g. naming a new home sub-page "Blog" quietly lands on "blog-2" instead
 * of shadowing the real /blog route.
 */
export async function ensureUniqueSlug(parentId: string, baseSlugInput: string): Promise<string> {
  const base = slugify(baseSlugInput) || "page";
  const startReserved = RESERVED_TOP_LEVEL_PAGE_SLUGS.has(base) && (await parentIsSiteRoot(parentId));
  let candidate = startReserved ? `${base}-2` : base;
  let suffix = startReserved ? 3 : 2;
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

const RESERVED_BLOG_POST_SLUGS = new Set(["category", "tag", "author", "page", "feed", "rss"]);

/**
 * "page" is reserved for a category/tag/author archive's own literal pagination
 * segment (blog/category/[catSlug]/page/[pageNum], etc.) — a taxonomy item slugged
 * bare "page" would make /blog/category/page/2 ambiguous between "page 2 of the
 * archive named 'page'" and "the 'page' sub-path of pagination itself."
 */
export function avoidPageReservedSlug(baseSlug: string, kindSuffix: string): string {
  return baseSlug === "page" ? `page-${kindSuffix}` : baseSlug;
}

/**
 * Same idea as ensureUniqueSlug but scoped to BlogPost.@@unique([templateId, slug]),
 * and rejecting (not auto-suffixing) the words reserved for blog archive routes
 * (app/pub/[domain]/blog/category|tag|author/**, blog/page/[n], blog/feed.xml) — a
 * post literally slugged "category" would be permanently shadowed by that route.
 */
export async function ensureUniqueBlogSlug(templateId: string, baseSlugInput: string): Promise<string> {
  const rawBase = slugify(baseSlugInput) || "post";
  const base = RESERVED_BLOG_POST_SLUGS.has(rawBase) ? `${rawBase}-post` : rawBase;
  let candidate = base;
  let suffix = 2;
  while (
    await prisma.blogPost.findFirst({
      where: { templateId, slug: candidate },
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
  sourceType: "BUILDER" | "RAW_UPLOAD";
}

/**
 * Resolves the whole page tree (root + every descendant, breadth-first)
 * that `anyPageId` belongs to, regardless of whether it's the root itself or
 * nested somewhere inside it. Shared by the REST pages-tree route and the
 * MCP get_landing_page_pages tool. Returns null if `anyPageId` doesn't
 * belong to `organizationId`.
 */
export async function getPageTree(organizationId: string, anyPageId: string): Promise<{ rootId: string; pages: PageTreeNode[] } | null> {
  if (!isValidUuid(anyPageId)) return null;
  const current = await prisma.template.findFirst({
    where: { id: anyPageId, organizationId },
    select: { id: true, parentId: true },
  });
  if (!current) return null;

  let rootId = current.id;
  let walkParentId = current.parentId;
  while (walkParentId) {
    const parent = await prisma.template.findFirst({
      where: { id: walkParentId, organizationId },
      select: { id: true, parentId: true },
    });
    if (!parent) break;
    rootId = parent.id;
    walkParentId = parent.parentId;
  }

  const root = await prisma.template.findFirst({
    where: { id: rootId, organizationId },
    select: { id: true, name: true, slug: true, parentId: true, order: true, updatedAt: true, sourceType: true },
  });
  if (!root) return null;

  const pages: PageTreeNode[] = [root];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await prisma.template.findMany({
      where: { parentId: { in: frontier }, organizationId },
      orderBy: { order: "asc" },
      select: { id: true, name: true, slug: true, parentId: true, order: true, updatedAt: true, sourceType: true },
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
export async function getDescendantIds(organizationId: string, pageId: string): Promise<string[]> {
  const result: string[] = [];
  let frontier = [pageId];
  while (frontier.length > 0) {
    const children = await prisma.template.findMany({
      where: { parentId: { in: frontier }, organizationId },
      select: { id: true },
    });
    result.push(...children.map((c) => c.id));
    frontier = children.map((c) => c.id);
  }
  return result;
}
