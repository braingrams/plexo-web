import { NextRequest, NextResponse } from "next/server";
import { listingPriceAndStock, publicVariantView } from "@/lib/commerce/variants";
import { EntityItem } from "electrodb";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { CommerceProduct, CommerceCategory, CommerceProductRelation, CommerceProductReview } from "@/lib/db/commerceEntities";

/** Powers the product/booking marker blocks and the product detail page — a single
 * product/service by id OR slug (the native block stores the id; a hand-authored page
 * could reasonably want a slug instead), plus its curated "frequently bought together"
 * relations. A SERVICE's open slots come from the separate
 * /api/public/commerce/availability endpoint (it already supports a from/to range for
 * "next week" navigation — no reason to duplicate that computation here). */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const hostname = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  const siteResult = await resolveSite(hostname);
  if (siteResult.status !== "ok") {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  const { templateId } = siteResult.published;

  // CommerceProduct's key is (templateId, id) — a direct .get() covers the id lookup; a
  // slug lookup has no dedicated index (see products/route.ts's comment on the same
  // limitation), so it fans out over the site's product list in memory.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let product: EntityItem<typeof CommerceProduct> | null = null;
  if (UUID_RE.test(id)) {
    ({ data: product } = await CommerceProduct.get({ templateId, id }).go());
  }
  if (!product) {
    const { data: products } = await CommerceProduct.query.primary({ templateId }).go({ pages: "all" });
    product = products.find((p) => p.slug === id) ?? null;
  }
  if (!product || !(product.active ?? true)) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }

  const [{ data: category }, { data: relations }, { data: reviewRows }] = await Promise.all([
    product.categoryId ? CommerceCategory.get({ templateId, id: product.categoryId }).go() : Promise.resolve({ data: null }),
    CommerceProductRelation.query.primary({ productId: product.id }).go({ pages: "all" }),
    CommerceProductReview.query.byProduct({ productId: product.id }).go({ pages: "all" }),
  ]);
  // Approved reviews only, newest first — name (never the email), stars, words, date.
  const approved = reviewRows.filter((r) => r.status === "APPROVED" && r.templateId === templateId).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const reviews = {
    count: approved.length,
    average: approved.length ? Math.round((approved.reduce((sum, r) => sum + (r.rating ?? 0), 0) / approved.length) * 10) / 10 : null,
    items: approved.slice(0, 20).map((r) => ({ name: r.customerName || "Customer", rating: r.rating, body: r.body ?? "", date: r.createdAt ?? null })),
  };

  const relatedIds = relations.slice(0, 4).map((r) => r.relatedProductId);
  const relatedProducts = await Promise.all(relatedIds.map((relatedId) => CommerceProduct.get({ templateId, id: relatedId }).go()));

  return NextResponse.json({
    product: {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description ?? null,
      imageUrl: product.imageUrl ?? null,
      galleryImageUrls: product.galleryImageUrls ?? [],
      kind: product.kind ?? "PHYSICAL",
      ...listingPriceAndStock(product),
      sku: product.sku ?? null,
      // Options (Size, Colour…) and each combination's price/sale price/stock/photo —
      // public/commerce.js's product page turns these into pickers.
      ...publicVariantView(product),
      currency: product.currency ?? "NGN",
      durationMinutes: product.durationMinutes ?? null,
      category: category ? { name: category.name, slug: category.slug } : null,
    },
    reviews,
    relatedProducts: relatedProducts
      .map((r) => r.data)
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map((p) => ({ id: p.id, name: p.name, slug: p.slug, imageUrl: p.imageUrl ?? null, ...listingPriceAndStock(p), currency: p.currency ?? "NGN", kind: p.kind ?? "PHYSICAL" })),
  });
}
