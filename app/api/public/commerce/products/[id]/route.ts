import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveSite } from "@/lib/pub/resolveSite";

/** Powers the product/booking marker blocks and the product detail page — a single
 * product/service by id OR slug (the native block stores the id; a hand-authored page
 * could reasonably want a slug instead), plus its curated "frequently bought together"
 * relations. A SERVICE's open slots come from the separate
 * /api/public/commerce/availability endpoint (it already supports a from/to range for
 * "next week" navigation — no reason to duplicate that computation here). */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const hostname = (request.headers.get("host") ?? "").split(":")[0];
  const siteResult = await resolveSite(hostname);
  if (siteResult.status !== "ok") {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  const { templateId } = siteResult.published;

  const product = await prisma.commerceProduct.findFirst({
    where: { templateId, active: true, OR: [{ id }, { slug: id }] },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      imageUrl: true,
      galleryImageUrls: true,
      kind: true,
      priceMinor: true,
      currency: true,
      stockQuantity: true,
      durationMinutes: true,
      category: { select: { name: true, slug: true } },
    },
  });
  if (!product) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }

  const related = await prisma.commerceProductRelation.findMany({
    where: { productId: product.id },
    include: { relatedProduct: { select: { id: true, name: true, slug: true, imageUrl: true, priceMinor: true, currency: true, kind: true } } },
    take: 4,
  });

  return NextResponse.json({
    product,
    relatedProducts: related.map((r) => r.relatedProduct),
  });
}
