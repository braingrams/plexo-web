import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";
import { slugify } from "@/server/slug";

async function ensureUniqueProductSlug(templateId: string, baseInput: string): Promise<string> {
  const base = slugify(baseInput) || "product";
  let candidate = base;
  let suffix = 2;
  while (await prisma.commerceProduct.findFirst({ where: { templateId, slug: candidate }, select: { id: true } })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function resolveCategoryId(templateId: string, organizationId: string, categoryName: unknown): Promise<string | null> {
  if (typeof categoryName !== "string" || !categoryName.trim()) return null;
  const name = categoryName.trim();
  const slug = slugify(name) || "category";
  const category = await prisma.commerceCategory.upsert({
    where: { templateId_slug: { templateId, slug } },
    create: { templateId, organizationId, name, slug },
    update: { name },
  });
  return category.id;
}

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const products = await prisma.commerceProduct.findMany({
    where: { templateId },
    include: { category: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  // Powers the shop_grid block's properties-panel "Show" dropdown (a real category, or
  // best-seller/most-recent) — same shape the public products endpoint already returns.
  const categories = await prisma.commerceCategory.findMany({
    where: { templateId },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ products, categories });
}

export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, role } = resolved.context;

  const permissionError = await requirePermission(request.headers, role, { commerce: ["create"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const { name, description, kind, priceMinor, stockQuantity, durationMinutes, imageUrl, galleryImageUrls, category, relatedProductIds } = body;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }
  if (kind !== "PHYSICAL" && kind !== "SERVICE") {
    return NextResponse.json({ error: "kind must be PHYSICAL or SERVICE." }, { status: 400 });
  }
  if (typeof priceMinor !== "number" || !Number.isInteger(priceMinor) || priceMinor < 0) {
    return NextResponse.json({ error: "priceMinor must be a non-negative integer (kobo)." }, { status: 400 });
  }

  const slug = await ensureUniqueProductSlug(templateId, name);
  const categoryId = await resolveCategoryId(templateId, organizationId, category);

  const product = await prisma.commerceProduct.create({
    data: {
      templateId,
      organizationId,
      categoryId,
      name: name.trim(),
      slug,
      description: typeof description === "string" ? description : null,
      kind,
      priceMinor,
      stockQuantity: kind === "PHYSICAL" && typeof stockQuantity === "number" ? Math.max(0, Math.trunc(stockQuantity)) : null,
      durationMinutes: kind === "SERVICE" && typeof durationMinutes === "number" ? Math.max(5, Math.trunc(durationMinutes)) : null,
      imageUrl: typeof imageUrl === "string" && imageUrl ? imageUrl : null,
      galleryImageUrls: Array.isArray(galleryImageUrls) ? galleryImageUrls.filter((u) => typeof u === "string") : undefined,
    },
  });

  if (Array.isArray(relatedProductIds) && relatedProductIds.length > 0) {
    const validIds = (
      await prisma.commerceProduct.findMany({ where: { id: { in: relatedProductIds }, templateId }, select: { id: true } })
    ).map((p) => p.id);
    await prisma.commerceProductRelation.createMany({
      data: validIds.map((relatedProductId) => ({ templateId, organizationId, productId: product.id, relatedProductId })),
      skipDuplicates: true,
    });
  }

  return NextResponse.json({ product }, { status: 201 });
}
