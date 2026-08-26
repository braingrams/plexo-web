import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveSite } from "@/lib/pub/resolveSite";

const SPECIAL_CATEGORIES = new Set(["best_seller", "most_recent"]);

/** Total units sold (from PAID orders only) per product, most-sold first — used for
 * `sort=best_seller`/`category=best_seller`. A product with zero sales simply doesn't
 * appear here; the caller appends those at the end so a brand-new catalog still shows
 * something sensible instead of an empty "best sellers" shelf. */
async function bestSellerProductIds(templateId: string): Promise<string[]> {
  const rows = await prisma.commerceOrderItem.groupBy({
    by: ["productId"],
    where: { order: { templateId, status: "PAID" } },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
  });
  return rows.map((r) => r.productId);
}

/** Powers both shop_grid modes (see plexo-sdk's shop_grid storeMode attr):
 * - storeMode (the default, unpaginated): every active product/service, optionally
 *   filtered by a real category slug or a name search — unchanged from before.
 * - curated (storeMode: false): a fixed `category` (a real slug, or the special values
 *   "best_seller"/"most_recent", which sort instead of filter), a `limit`, and optional
 *   `page`/`pageSize` pagination — for a marketing section rather than a full shop page. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("host") ?? "").split(":")[0];
  const siteResult = await resolveSite(hostname);
  if (siteResult.status !== "ok") {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  const { templateId } = siteResult.published;

  const categoryParam = request.nextUrl.searchParams.get("category");
  const search = request.nextUrl.searchParams.get("q")?.trim();
  const isSpecialCategory = categoryParam ? SPECIAL_CATEGORIES.has(categoryParam) : false;
  const categorySlug = categoryParam && !isSpecialCategory ? categoryParam : null;

  const limitParam = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : null;
  const pageParam = Number(request.nextUrl.searchParams.get("page"));
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const pageSizeParam = Number(request.nextUrl.searchParams.get("pageSize"));
  const pageSize = Number.isFinite(pageSizeParam) && pageSizeParam > 0 ? Math.min(Math.floor(pageSizeParam), 100) : null;

  const baseWhere = {
    templateId,
    active: true,
    ...(categorySlug ? { category: { slug: categorySlug } } : {}),
    ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
  };

  const selectFields = {
    id: true,
    name: true,
    slug: true,
    description: true,
    imageUrl: true,
    kind: true,
    priceMinor: true,
    currency: true,
    stockQuantity: true,
    durationMinutes: true,
    createdAt: true,
    category: { select: { name: true, slug: true } },
  } as const;

  let products: Array<Record<string, unknown>>;
  let total: number;

  if (categoryParam === "best_seller") {
    // Sorted by real sales — can't express "order by an external aggregate, with
    // never-sold rows appended at the end" as a single Prisma orderBy, so this fetches
    // the ranked id list, then the full rows, then reorders in memory.
    const rankedIds = await bestSellerProductIds(templateId);
    const all = await prisma.commerceProduct.findMany({ where: baseWhere, select: selectFields, orderBy: { name: "asc" } });
    const rank = new Map(rankedIds.map((id, i) => [id, i]));
    all.sort((a, b) => {
      const ra = rank.has(a.id as string) ? (rank.get(a.id as string) as number) : Infinity;
      const rb = rank.has(b.id as string) ? (rank.get(b.id as string) as number) : Infinity;
      return ra - rb;
    });
    total = all.length;
    products = pageSize ? all.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize) : limit ? all.slice(0, limit) : all;
  } else {
    const orderBy = categoryParam === "most_recent" ? ({ createdAt: "desc" } as const) : ({ name: "asc" } as const);
    total = await prisma.commerceProduct.count({ where: baseWhere });
    products = await prisma.commerceProduct.findMany({
      where: baseWhere,
      select: selectFields,
      orderBy,
      ...(pageSize ? { skip: (page - 1) * pageSize, take: pageSize } : limit ? { take: limit } : {}),
    });
  }

  const categories = await prisma.commerceCategory.findMany({ where: { templateId }, select: { name: true, slug: true }, orderBy: { name: "asc" } });

  return NextResponse.json({
    products,
    categories,
    total,
    page,
    pageSize: pageSize ?? total,
  });
}
