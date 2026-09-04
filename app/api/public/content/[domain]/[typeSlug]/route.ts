import { NextRequest, NextResponse } from "next/server";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { CustomContentType, CustomContentEntry } from "@/lib/db/customContentEntities";

/**
 * GET /api/public/content/:domain/:typeSlug
 *
 * The public, unauthenticated, read-only headless-CMS surface for custom content types —
 * "genuinely usable as a headless CMS even without deep SDK/page-builder binding" per this
 * feature's v1 scope. Resolves the site the same way app/pub/[domain]/[[...slug]]/route.ts does
 * (resolveSite() — same ".localhost" dev-normalization, same active/suspended gate), looks up the
 * CustomContentType by templateId + typeSlug, and returns only its PUBLISHED entries — same
 * trust model as the existing public commerce/blog read APIs (no auth: this is data the site
 * owner has explicitly marked published and public).
 *
 * :domain is a path segment, decoded the same way [[...slug]]/route.ts decodes it — NOT resolved
 * from a request Host header the way app/api/public/commerce/** does, since this route has no
 * concept of "the site currently serving this request" (it's a headless data API, callable from
 * anywhere, not from a page rendered on the site itself).
 *
 * Pagination mirrors app/api/public/commerce/products/route.ts's own convention (page/pageSize,
 * or a flat limit with no page) — fetch-then-slice-in-memory, since a content type's entry list
 * is already a single un-GSI'd contentTypeId-scoped query with no cursor-friendly index to page
 * against, same bound as that route's own product listing.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ domain: string; typeSlug: string }> },
): Promise<NextResponse> {
  const { domain: rawDomain, typeSlug: rawTypeSlug } = await context.params;
  const domain = decodeURIComponent(rawDomain);
  const typeSlug = decodeURIComponent(rawTypeSlug);

  const siteResult = await resolveSite(domain);
  if (siteResult.status === "not_found") {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  if (siteResult.status === "suspended") {
    return NextResponse.json({ error: "This site is unavailable." }, { status: 403 });
  }
  const { templateId } = siteResult.published;

  const { data: contentTypes } = await CustomContentType.query.primary({ templateId }).go();
  const contentType = contentTypes.find((ct) => ct.slug === typeSlug);
  if (!contentType) {
    return NextResponse.json({ error: `No content type "${typeSlug}" found for this site.` }, { status: 404 });
  }

  const limitParam = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 200) : null;
  const pageParam = Number(request.nextUrl.searchParams.get("page"));
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const pageSizeParam = Number(request.nextUrl.searchParams.get("pageSize"));
  const pageSize = Number.isFinite(pageSizeParam) && pageSizeParam > 0 ? Math.min(Math.floor(pageSizeParam), 100) : null;

  const { data: allEntries } = await CustomContentEntry.query.primary({ contentTypeId: contentType.id }).go();
  const published = allEntries
    .filter((e) => e.status === "PUBLISHED")
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const total = published.length;
  const mapped = published.map((e) => ({
    id: e.id,
    createdAt: e.createdAt,
    ...(e.data && typeof e.data === "object" ? (e.data as Record<string, unknown>) : {}),
  }));
  const entries = pageSize
    ? mapped.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
    : limit
      ? mapped.slice(0, limit)
      : mapped;

  return NextResponse.json({
    contentType: { id: contentType.id, name: contentType.name, slug: contentType.slug },
    entries,
    total,
    page,
    pageSize: pageSize ?? total,
  });
}
