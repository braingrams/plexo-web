import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";
import { slugify } from "@/server/slug";
import { encryptDigitalAccessSecret } from "@/lib/crypto";

// Never send the encrypted password ciphertext to the client — see products/route.ts's copy
// of this same helper.
function toPublicProduct<T extends { digitalAccessPasswordEncrypted: string | null }>(product: T) {
  const { digitalAccessPasswordEncrypted, ...rest } = product;
  return { ...rest, hasDigitalAccessPassword: Boolean(digitalAccessPasswordEncrypted) };
}

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
    product: { ...toPublicProduct(product), relatedProductIds: product.relatedFrom.map((r) => r.relatedProductId) },
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
  const {
    name, description, priceMinor, stockQuantity, durationMinutes, imageUrl, galleryImageUrls, category, active, relatedProductIds,
    digitalDeliveryMethod, digitalFileUrl, digitalFileName, digitalExternalUrl, digitalAccessInstructions, digitalAccessPassword,
    digitalMaxDownloads, digitalLinkExpiryDays,
  } = body;

  if (priceMinor !== undefined && (typeof priceMinor !== "number" || !Number.isInteger(priceMinor) || priceMinor < 0)) {
    return NextResponse.json({ error: "priceMinor must be a non-negative integer (kobo)." }, { status: 400 });
  }
  if (existing.kind === "DIGITAL" && digitalDeliveryMethod !== undefined) {
    if (digitalDeliveryMethod !== "FILE_DOWNLOAD" && digitalDeliveryMethod !== "EXTERNAL_LINK" && digitalDeliveryMethod !== "ACCESS_LIST") {
      return NextResponse.json({ error: "digitalDeliveryMethod must be FILE_DOWNLOAD, EXTERNAL_LINK, or ACCESS_LIST." }, { status: 400 });
    }
  }

  const categoryId = await resolveCategoryId(templateId, organizationId, category);
  const isDigital = existing.kind === "DIGITAL";
  const effectiveDeliveryMethod = isDigital ? (digitalDeliveryMethod ?? existing.digitalDeliveryMethod) : null;

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
      digitalDeliveryMethod: isDigital ? effectiveDeliveryMethod : undefined,
      digitalFileUrl:
        isDigital && effectiveDeliveryMethod === "FILE_DOWNLOAD" && typeof digitalFileUrl === "string"
          ? digitalFileUrl || null
          : isDigital && effectiveDeliveryMethod !== "FILE_DOWNLOAD"
            ? null
            : undefined,
      digitalFileName:
        isDigital && effectiveDeliveryMethod === "FILE_DOWNLOAD" && typeof digitalFileName === "string"
          ? digitalFileName || null
          : isDigital && effectiveDeliveryMethod !== "FILE_DOWNLOAD"
            ? null
            : undefined,
      digitalExternalUrl:
        isDigital && effectiveDeliveryMethod === "EXTERNAL_LINK"
          ? (typeof digitalExternalUrl === "string" ? digitalExternalUrl || null : undefined)
          : isDigital
            ? null
            : undefined,
      digitalAccessInstructions:
        isDigital && effectiveDeliveryMethod === "ACCESS_LIST"
          ? (typeof digitalAccessInstructions === "string" ? digitalAccessInstructions || null : undefined)
          : isDigital
            ? null
            : undefined,
      // Blank/omitted means "keep the existing password" — only overwritten when a real
      // new value is sent, matching ProductsClient.tsx's write-only password field.
      digitalAccessPasswordEncrypted:
        isDigital && effectiveDeliveryMethod === "ACCESS_LIST"
          ? (typeof digitalAccessPassword === "string" && digitalAccessPassword ? encryptDigitalAccessSecret(digitalAccessPassword) : undefined)
          : isDigital
            ? null
            : undefined,
      digitalMaxDownloads: isDigital && typeof digitalMaxDownloads === "number" ? Math.max(1, Math.trunc(digitalMaxDownloads)) : isDigital && digitalMaxDownloads === null ? null : undefined,
      digitalLinkExpiryDays: isDigital && typeof digitalLinkExpiryDays === "number" ? Math.max(1, Math.trunc(digitalLinkExpiryDays)) : isDigital && digitalLinkExpiryDays === null ? null : undefined,
    },
  });

  if (Array.isArray(relatedProductIds)) {
    // Staff-curated, not a recommendation engine (see the Commerce plan) — capped at 3
    // here too, not just in the dashboard form, since this is a real API contract another
    // caller could hit directly.
    const validIds = (
      await prisma.commerceProduct.findMany({ where: { id: { in: relatedProductIds.slice(0, 3) }, templateId }, select: { id: true } })
    ).map((p) => p.id);
    await prisma.$transaction([
      prisma.commerceProductRelation.deleteMany({ where: { productId: id } }),
      prisma.commerceProductRelation.createMany({
        data: validIds.filter((rid) => rid !== id).map((relatedProductId) => ({ templateId, organizationId, productId: id, relatedProductId })),
        skipDuplicates: true,
      }),
    ]);
  }

  return NextResponse.json({ product: toPublicProduct(product) });
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

  return NextResponse.json({ product: toPublicProduct(product) });
}
