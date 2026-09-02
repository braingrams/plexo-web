// Pure slug/UUID helpers shared by server/slugDynamo.ts and every other call site that
// only ever needed these four functions, not the rest of server/slug.ts's Prisma-backed
// page-tree logic (which server/slugDynamo.ts fully reimplements against DynamoDB) — kept
// in their own module so importing them never pulls in a Prisma client at all.

const SLUG_SEGMENT_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guards page-tree routes against a malformed id (e.g. a caller bug that
 * passes "undefined" as a literal string) reaching a lookup as a raw query
 * param — left unchecked this can surface as an opaque 500 instead of a
 * clean 404/400. AI/MCP callers are exactly the kind of client most likely
 * to hit this from a client-side bug, so the error should be actionable
 * rather than a crash.
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
 * "page" is reserved for a category/tag/author archive's own literal pagination
 * segment (blog/category/[catSlug]/page/[pageNum], etc.) — a taxonomy item slugged
 * bare "page" would make /blog/category/page/2 ambiguous between "page 2 of the
 * archive named 'page'" and "the 'page' sub-path of pagination itself."
 */
export function avoidPageReservedSlug(baseSlug: string, kindSuffix: string): string {
  return baseSlug === "page" ? `page-${kindSuffix}` : baseSlug;
}
