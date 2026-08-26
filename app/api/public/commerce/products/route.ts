import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveSite } from "@/lib/pub/resolveSite";

/** Powers the shop_grid marker — every active product/service on the site, optionally
 * filtered by category slug or a name search. No pagination yet (a catalog this size
 * doesn't need it); add one if a site's catalog ever grows into the hundreds. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("host") ?? "").split(":")[0];
  const siteResult = await resolveSite(hostname);
  if (siteResult.status !== "ok") {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  const { templateId } = siteResult.published;

  const categorySlug = request.nextUrl.searchParams.get("category");
  const search = request.nextUrl.searchParams.get("q")?.trim();

  const products = await prisma.commerceProduct.findMany({
    where: {
      templateId,
      active: true,
      ...(categorySlug ? { category: { slug: categorySlug } } : {}),
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    },
    select: {
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
      category: { select: { name: true, slug: true } },
    },
    orderBy: { name: "asc" },
  });

  const categories = await prisma.commerceCategory.findMany({ where: { templateId }, select: { name: true, slug: true }, orderBy: { name: "asc" } });

  return NextResponse.json({ products, categories });
}
