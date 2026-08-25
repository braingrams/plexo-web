import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";
import { slugify } from "@/server/slug";

async function resolveCategoryId(templateId: string, organizationId: string, categoryName: unknown): Promise<string | null | undefined> {
  if (categoryName === undefined) return undefined; // not provided — leave unchanged
  if (typeof categoryName !== "string" || !categoryName.trim()) return null; // explicitly cleared
  const name = categoryName.trim();
  const slug = slugify(name) || "category";
  const category = await prisma.commerceCategory.upsert({
    where: { templateId_slug: { templateId, slug } },
    create: { templateId, organizationId, name, slug },
    update: { name },
  });
  return category.id;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; id: string }> },
): Promise<NextResponse> {
  const { templateId, id } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const product = await prisma.commerceProduct.findFirst({
    where: { id, templateId },
    include: {
      category: { select: { id: true, name: true } },
      relatedFrom: { select: { relatedProductId: true } },
    },
  });
  if (!product) return NextResponse.json({ error: "Product not found." }, { status: 404 });

  return NextResponse.json({
    product: { ...product, relatedProductIds: product.relatedFrom.map((r) => r.relatedProductId) },
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; id: string }> },
): Promise<NextResponse> {
  const { templateId, id } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, role } = resolved.context;

  const permissionError = await requirePermission(request.headers, role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const existing = await prisma.commerceProduct.findFirst({ where: { id, templateId } });
  if (!existing) return NextResponse.json({ error: "Product not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { name, description, priceMinor, stockQuantity, durationMinutes, imageUrl, galleryImageUrls, category, active, relatedProductIds } = body;

  if (priceMinor !== undefined && (typeof priceMinor !== "number" || !Number.isInteger(priceMinor) || priceMinor < 0)) {
    return NextResponse.json({ error: "priceMinor must be a non-negative integer (kobo)." }, { status: 400 });
  }

  const categoryId = await resolveCategoryId(templateId, organizationId, category);

  const product = await prisma.commerceProduct.update({
    where: { id },
    data: {
      name: typeof name === "string" && name.trim() ? name.trim() : undefined,
      description: description === undefined ? undefined : typeof description === "string" ? description : null,
      priceMinor: typeof priceMinor === "number" ? priceMinor : undefined,
      stockQuantity:
        existing.kind === "PHYSICAL" && typeof stockQuantity === "number" ? Math.max(0, Math.trunc(stockQuantity)) : undefined,
      durationMinutes:
        existing.kind === "SERVICE" && typeof durationMinutes === "number" ? Math.max(5, Math.trunc(durationMinutes)) : undefined,
      imageUrl: imageUrl === undefined ? undefined : typeof imageUrl === "string" && imageUrl ? imageUrl : null,
      galleryImageUrls: Array.isArray(galleryImageUrls) ? galleryImageUrls.filter((u) => typeof u === "string") : undefined,
      categoryId,
      active: typeof active === "boolean" ? active : undefined,
    },
  });

  if (Array.isArray(relatedProductIds)) {
    const validIds = (
      await prisma.commerceProduct.findMany({ where: { id: { in: relatedProductIds }, templateId }, select: { id: true } })
    ).map((p) => p.id);
    await prisma.$transaction([
      prisma.commerceProductRelation.deleteMany({ where: { productId: id } }),
      prisma.commerceProductRelation.createMany({
        data: validIds.filter((rid) => rid !== id).map((relatedProductId) => ({ templateId, organizationId, productId: id, relatedProductId })),
        skipDuplicates: true,
      }),
    ]);
  }

  return NextResponse.json({ product });
}

// Soft delete only — a product with real order history can't be hard-deleted anyway
// (CommerceOrderItem.product is onDelete: Restrict), and deactivating is the correct
// action for a storefront listing regardless: stop selling it, keep the history intact.
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; id: string }> },
): Promise<NextResponse> {
  const { templateId, id } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = await requirePermission(request.headers, role, { commerce: ["delete"] });
  if (permissionError) return permissionError;

  const existing = await prisma.commerceProduct.findFirst({ where: { id, templateId } });
  if (!existing) return NextResponse.json({ error: "Product not found." }, { status: 404 });

  const product = await prisma.commerceProduct.update({
    where: { id },
    data: { active: false, suspendedAt: new Date() },
  });

  return NextResponse.json({ product });
}
