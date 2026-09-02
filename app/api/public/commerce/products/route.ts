import { NextRequest, NextResponse } from "next/server";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { CommerceProduct, CommerceCategory, CommerceOrder, CommerceOrderItem } from "@/lib/db/commerceEntities";

const SPECIAL_CATEGORIES = new Set(["best_seller", "most_recent"]);

/** Total units sold (from PAID orders only) per product, most-sold first — used for
 * `sort=best_seller`/`category=best_seller`. A product with zero sales simply doesn't
 * appear here; the caller appends those at the end so a brand-new catalog still shows
 * something sensible instead of an empty "best sellers" shelf.
 *
 * No productId-indexed access pattern for CommerceOrderItem exists (it's co-located
 * under its parent order, see commerceEntities.ts) — this fans out across every PAID
 * order for the site and sums in memory, same "small in practice" bound as the rest of
 * this migration's site-scoped aggregations. */
async function bestSellerProductIds(templateId: string): Promise<string[]> {
  const { data: orders } = await CommerceOrder.query.primary({ templateId }).go();
  const paidOrderIds = orders.filter((o) => o.status === "PAID").map((o) => o.id);
  const itemBatches = await Promise.all(paidOrderIds.map((orderId) => CommerceOrderItem.query.primary({ templateId, orderId }).go()));
  const totals = new Map<string, number>();
  for (const batch of itemBatches) {
    for (const item of batch.data) {
      totals.set(item.productId, (totals.get(item.productId) ?? 0) + (item.quantity ?? 1));
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([productId]) => productId);
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
  const search = request.nextUrl.searchParams.get("q")?.trim().toLowerCase();
  const isSpecialCategory = categoryParam ? SPECIAL_CATEGORIES.has(categoryParam) : false;
  const categorySlug = categoryParam && !isSpecialCategory ? categoryParam : null;

  const limitParam = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : null;
  const pageParam = Number(request.nextUrl.searchParams.get("page"));
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const pageSizeParam = Number(request.nextUrl.searchParams.get("pageSize"));
  const pageSize = Number.isFinite(pageSizeParam) && pageSizeParam > 0 ? Math.min(Math.floor(pageSizeParam), 100) : null;

  const [{ data: allProducts }, { data: categories }] = await Promise.all([
    CommerceProduct.query.primary({ templateId }).go(),
    CommerceCategory.query.primary({ templateId }).go(),
  ]);
  const categoryBySlug = new Map(categories.map((c) => [c.slug, c]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const targetCategory = categorySlug ? categoryBySlug.get(categorySlug) : null;

  let filtered = allProducts.filter((p) => p.active ?? true);
  if (categorySlug) {
    filtered = targetCategory ? filtered.filter((p) => p.categoryId === targetCategory.id) : [];
  }
  if (search) {
    filtered = filtered.filter((p) => p.name.toLowerCase().includes(search));
  }

  const selectProduct = (p: (typeof allProducts)[number]) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description ?? null,
    imageUrl: p.imageUrl ?? null,
    kind: p.kind ?? "PHYSICAL",
    priceMinor: p.priceMinor,
    currency: p.currency ?? "NGN",
    stockQuantity: p.stockQuantity ?? null,
    durationMinutes: p.durationMinutes ?? null,
    createdAt: p.createdAt,
    category: p.categoryId && categoryById.has(p.categoryId) ? { name: categoryById.get(p.categoryId)!.name, slug: categoryById.get(p.categoryId)!.slug } : null,
  });

  let products: ReturnType<typeof selectProduct>[];
  let total: number;

  if (categoryParam === "best_seller") {
    // Sorted by real sales, never-sold rows appended at the end.
    const rankedIds = await bestSellerProductIds(templateId);
    const rank = new Map(rankedIds.map((id, i) => [id, i]));
    const sorted = [...filtered].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id)! : Infinity;
      const rb = rank.has(b.id) ? rank.get(b.id)! : Infinity;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
    total = sorted.length;
    const mapped = sorted.map(selectProduct);
    products = pageSize ? mapped.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize) : limit ? mapped.slice(0, limit) : mapped;
  } else {
    const sorted =
      categoryParam === "most_recent"
        ? [...filtered].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
        : [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    total = sorted.length;
    const mapped = sorted.map(selectProduct);
    products = pageSize ? mapped.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize) : limit ? mapped.slice(0, limit) : mapped;
  }

  const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ name: c.name, slug: c.slug }));

  return NextResponse.json({
    products,
    categories: sortedCategories,
    total,
    page,
    pageSize: pageSize ?? total,
  });
}
