import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { slugify } from "@/server/slugDynamo";
import { encryptDigitalAccessSecret } from "@/lib/crypto";
import { CommerceProduct, CommerceCategory, CommerceProductRelation } from "@/lib/db/commerceEntities";

// Never send the encrypted password ciphertext to the client — see products/route.ts's copy
// of this same helper.
function toPublicProduct<T extends { digitalAccessPasswordEncrypted?: string }>(product: T) {
  const { digitalAccessPasswordEncrypted, ...rest } = product;
  return { ...rest, hasDigitalAccessPassword: Boolean(digitalAccessPasswordEncrypted) };
}

async function resolveCategoryId(templateId: string, organizationId: string, categoryName: unknown): Promise<string | null | undefined> {
  if (categoryName === undefined) return undefined; // not provided — leave unchanged
  if (typeof categoryName !== "string" || !categoryName.trim()) return null; // explicitly cleared
  const name = categoryName.trim();
  const slug = slugify(name) || "category";
  const { data: categories } = await CommerceCategory.query.primary({ templateId }).go();
  const existing = categories.find((c) => c.slug === slug);
  if (existing) {
    if (existing.name !== name) await CommerceCategory.patch({ templateId, id: existing.id }).set({ name }).go();
    return existing.id;
  }
  const id = randomUUID();
  await CommerceCategory.create({ id, templateId, organizationId, name, slug }).go();
  return id;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; id: string }> },
): Promise<NextResponse> {
  const { templateId, id } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const [{ data: product }, { data: relations }] = await Promise.all([
    CommerceProduct.get({ templateId, id }).go(),
    CommerceProductRelation.query.primary({ productId: id }).go(),
  ]);
  if (!product) return NextResponse.json({ error: "Product not found." }, { status: 404 });

  let category: { id: string; name: string } | null = null;
  if (product.categoryId) {
    const { data: cat } = await CommerceCategory.get({ templateId, id: product.categoryId }).go();
    if (cat) category = { id: cat.id, name: cat.name };
  }

  return NextResponse.json({
    product: { ...toPublicProduct(product), category, relatedProductIds: relations.map((r) => r.relatedProductId) },
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

  const permissionError = requirePermission(role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const { data: existing } = await CommerceProduct.get({ templateId, id }).go();
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

  const data: Record<string, unknown> = {};
  const toRemove: string[] = [];

  if (typeof name === "string" && name.trim()) data.name = name.trim();
  if (description !== undefined) {
    if (typeof description === "string" && description) data.description = description;
    else toRemove.push("description");
  }
  if (typeof priceMinor === "number") data.priceMinor = priceMinor;
  if (existing.kind === "PHYSICAL" && typeof stockQuantity === "number") data.stockQuantity = Math.max(0, Math.trunc(stockQuantity));
  if (existing.kind === "SERVICE" && typeof durationMinutes === "number") data.durationMinutes = Math.max(5, Math.trunc(durationMinutes));
  if (imageUrl !== undefined) {
    if (typeof imageUrl === "string" && imageUrl) data.imageUrl = imageUrl;
    else toRemove.push("imageUrl");
  }
  if (Array.isArray(galleryImageUrls)) data.galleryImageUrls = galleryImageUrls.filter((u) => typeof u === "string");
  if (categoryId !== undefined) {
    if (categoryId) data.categoryId = categoryId;
    else toRemove.push("categoryId");
  }
  if (typeof active === "boolean") data.active = active;

  if (isDigital) {
    data.digitalDeliveryMethod = effectiveDeliveryMethod;

    if (effectiveDeliveryMethod === "FILE_DOWNLOAD") {
      if (typeof digitalFileUrl === "string") {
        if (digitalFileUrl) data.digitalFileUrl = digitalFileUrl;
        else toRemove.push("digitalFileUrl");
      }
      if (typeof digitalFileName === "string") {
        if (digitalFileName) data.digitalFileName = digitalFileName;
        else toRemove.push("digitalFileName");
      }
      toRemove.push("digitalExternalUrl", "digitalAccessInstructions", "digitalAccessPasswordEncrypted");
    } else if (effectiveDeliveryMethod === "EXTERNAL_LINK") {
      if (typeof digitalExternalUrl === "string") {
        if (digitalExternalUrl) data.digitalExternalUrl = digitalExternalUrl;
        else toRemove.push("digitalExternalUrl");
      }
      toRemove.push("digitalFileUrl", "digitalFileName", "digitalAccessInstructions", "digitalAccessPasswordEncrypted");
    } else if (effectiveDeliveryMethod === "ACCESS_LIST") {
      if (typeof digitalAccessInstructions === "string") {
        if (digitalAccessInstructions) data.digitalAccessInstructions = digitalAccessInstructions;
        else toRemove.push("digitalAccessInstructions");
      }
      // Blank/omitted means "keep the existing password" — only overwritten when a real
      // new value is sent, matching ProductsClient.tsx's write-only password field.
      if (typeof digitalAccessPassword === "string" && digitalAccessPassword) {
        data.digitalAccessPasswordEncrypted = encryptDigitalAccessSecret(digitalAccessPassword);
      }
      toRemove.push("digitalFileUrl", "digitalFileName", "digitalExternalUrl");
    }

    if (typeof digitalMaxDownloads === "number") data.digitalMaxDownloads = Math.max(1, Math.trunc(digitalMaxDownloads));
    else if (digitalMaxDownloads === null) toRemove.push("digitalMaxDownloads");
    if (typeof digitalLinkExpiryDays === "number") data.digitalLinkExpiryDays = Math.max(1, Math.trunc(digitalLinkExpiryDays));
    else if (digitalLinkExpiryDays === null) toRemove.push("digitalLinkExpiryDays");
  }

  let patch = CommerceProduct.patch({ templateId, id }).set(data);
  const uniqueRemove = [...new Set(toRemove)].filter((f) => !(f in data));
  if (uniqueRemove.length) patch = patch.remove(uniqueRemove as any);
  await patch.go();
  const { data: product } = await CommerceProduct.get({ templateId, id }).go();
  if (!product) throw new Error(`CommerceProduct ${id} vanished immediately after being updated`);

  if (Array.isArray(relatedProductIds)) {
    // Staff-curated, not a recommendation engine (see the Commerce plan) — capped at 3
    // here too, not just in the dashboard form, since this is a real API contract another
    // caller could hit directly.
    const capped = relatedProductIds.slice(0, 3).filter((rid: unknown) => typeof rid === "string" && rid !== id);
    const { data: candidateProducts } = await CommerceProduct.query.primary({ templateId }).go();
    const validIds = candidateProducts.filter((p) => capped.includes(p.id)).map((p) => p.id);

    const { data: existingRelations } = await CommerceProductRelation.query.primary({ productId: id }).go();
    await Promise.all(existingRelations.map((r) => CommerceProductRelation.remove({ productId: r.productId, relatedProductId: r.relatedProductId }).go()));
    await Promise.all(
      validIds.map((relatedProductId) => CommerceProductRelation.create({ id: randomUUID(), templateId, organizationId, productId: id, relatedProductId }).go()),
    );
  }

  return NextResponse.json({ product: toPublicProduct(product) });
}

// Soft delete only — a product with real order history can't be hard-deleted anyway
// (Prisma's CommerceOrderItem.product was onDelete: Restrict; DynamoDB has no equivalent
// FK enforcement, but deactivating is still the correct action for a storefront listing
// regardless: stop selling it, keep the history intact).
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; id: string }> },
): Promise<NextResponse> {
  const { templateId, id } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = requirePermission(role, { commerce: ["delete"] });
  if (permissionError) return permissionError;

  const { data: existing } = await CommerceProduct.get({ templateId, id }).go();
  if (!existing) return NextResponse.json({ error: "Product not found." }, { status: 404 });

  await CommerceProduct.patch({ templateId, id }).set({ active: false, suspendedAt: new Date().toISOString() }).go();
  const { data: product } = await CommerceProduct.get({ templateId, id }).go();
  if (!product) throw new Error(`CommerceProduct ${id} vanished immediately after being updated`);

  return NextResponse.json({ product: toPublicProduct(product) });
}
