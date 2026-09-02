import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { slugify } from "@/server/slugDynamo";
import { encryptDigitalAccessSecret } from "@/lib/crypto";
import { CommerceProduct, CommerceCategory, CommerceProductRelation } from "@/lib/db/commerceEntities";

// Never send the encrypted password ciphertext to the client — hasDigitalAccessPassword is
// enough for the UI to know one is set (see ProductsClient.tsx's "leave blank to keep
// unchanged" convention).
function toPublicProduct<T extends { digitalAccessPasswordEncrypted?: string }>(product: T) {
  const { digitalAccessPasswordEncrypted, ...rest } = product;
  return { ...rest, hasDigitalAccessPassword: Boolean(digitalAccessPasswordEncrypted) };
}

// CommerceProduct/CommerceCategory are both id-keyed (primary: templateId + id, see
// commerceEntities.ts), not slug-keyed — unlike BlogPost/BlogCategory in the Content
// context, so a slug/name lookup here has to scan the template's own product or category
// list in memory rather than a direct .get(). Small in practice (one site's catalog).
async function ensureUniqueProductSlug(templateId: string, baseInput: string): Promise<string> {
  const base = slugify(baseInput) || "product";
  const { data: products } = await CommerceProduct.query.primary({ templateId }).go();
  const slugs = new Set(products.map((p) => p.slug));
  let candidate = base;
  let suffix = 2;
  while (slugs.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function resolveCategoryId(templateId: string, organizationId: string, categoryName: unknown): Promise<string | null> {
  if (typeof categoryName !== "string" || !categoryName.trim()) return null;
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

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const [{ data: products }, { data: categories }] = await Promise.all([
    CommerceProduct.query.primary({ templateId }).go(),
    CommerceCategory.query.primary({ templateId }).go(),
  ]);
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const sortedProducts = [...products].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ id: c.id, name: c.name, slug: c.slug }));

  return NextResponse.json({
    products: sortedProducts.map((p) => ({
      ...toPublicProduct(p),
      category: p.categoryId && categoryById.has(p.categoryId) ? { id: p.categoryId, name: categoryById.get(p.categoryId)!.name } : null,
    })),
    categories: sortedCategories,
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, role } = resolved.context;

  const permissionError = requirePermission(role, { commerce: ["create"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const {
    name, description, kind, priceMinor, stockQuantity, durationMinutes, imageUrl, galleryImageUrls, category, relatedProductIds,
    digitalDeliveryMethod, digitalFileUrl, digitalFileName, digitalExternalUrl, digitalAccessInstructions, digitalAccessPassword,
    digitalMaxDownloads, digitalLinkExpiryDays,
  } = body;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }
  if (kind !== "PHYSICAL" && kind !== "SERVICE" && kind !== "DIGITAL") {
    return NextResponse.json({ error: "kind must be PHYSICAL, SERVICE, or DIGITAL." }, { status: 400 });
  }
  if (typeof priceMinor !== "number" || !Number.isInteger(priceMinor) || priceMinor < 0) {
    return NextResponse.json({ error: "priceMinor must be a non-negative integer (kobo)." }, { status: 400 });
  }
  if (kind === "DIGITAL") {
    if (digitalDeliveryMethod !== "FILE_DOWNLOAD" && digitalDeliveryMethod !== "EXTERNAL_LINK" && digitalDeliveryMethod !== "ACCESS_LIST") {
      return NextResponse.json({ error: "digitalDeliveryMethod must be FILE_DOWNLOAD, EXTERNAL_LINK, or ACCESS_LIST." }, { status: 400 });
    }
    if (digitalDeliveryMethod === "FILE_DOWNLOAD" && (typeof digitalFileUrl !== "string" || !digitalFileUrl)) {
      return NextResponse.json({ error: "A file is required for the File download delivery method." }, { status: 400 });
    }
    if (digitalDeliveryMethod === "EXTERNAL_LINK" && (typeof digitalExternalUrl !== "string" || !digitalExternalUrl)) {
      return NextResponse.json({ error: "A link is required for the External link delivery method." }, { status: 400 });
    }
    if (digitalDeliveryMethod === "ACCESS_LIST" && (typeof digitalAccessInstructions !== "string" || !digitalAccessInstructions.trim())) {
      return NextResponse.json({ error: "Instructions are required for the Access list delivery method." }, { status: 400 });
    }
  }

  const slug = await ensureUniqueProductSlug(templateId, name);
  const categoryId = await resolveCategoryId(templateId, organizationId, category);

  const productId = randomUUID();
  await CommerceProduct.create({
    id: productId,
    templateId,
    organizationId,
    categoryId: categoryId ?? undefined,
    name: name.trim(),
    slug,
    description: typeof description === "string" ? description : undefined,
    kind,
    priceMinor,
    stockQuantity: kind === "PHYSICAL" && typeof stockQuantity === "number" ? Math.max(0, Math.trunc(stockQuantity)) : undefined,
    durationMinutes: kind === "SERVICE" && typeof durationMinutes === "number" ? Math.max(5, Math.trunc(durationMinutes)) : undefined,
    imageUrl: typeof imageUrl === "string" && imageUrl ? imageUrl : undefined,
    galleryImageUrls: Array.isArray(galleryImageUrls) ? galleryImageUrls.filter((u) => typeof u === "string") : undefined,
    digitalDeliveryMethod: kind === "DIGITAL" ? digitalDeliveryMethod : undefined,
    digitalFileUrl: kind === "DIGITAL" && digitalDeliveryMethod === "FILE_DOWNLOAD" && typeof digitalFileUrl === "string" ? digitalFileUrl : undefined,
    digitalFileName: kind === "DIGITAL" && digitalDeliveryMethod === "FILE_DOWNLOAD" && typeof digitalFileName === "string" ? digitalFileName : undefined,
    digitalExternalUrl: kind === "DIGITAL" && digitalDeliveryMethod === "EXTERNAL_LINK" && typeof digitalExternalUrl === "string" ? digitalExternalUrl : undefined,
    digitalAccessInstructions: kind === "DIGITAL" && digitalDeliveryMethod === "ACCESS_LIST" && typeof digitalAccessInstructions === "string" ? digitalAccessInstructions : undefined,
    digitalAccessPasswordEncrypted:
      kind === "DIGITAL" && digitalDeliveryMethod === "ACCESS_LIST" && typeof digitalAccessPassword === "string" && digitalAccessPassword
        ? encryptDigitalAccessSecret(digitalAccessPassword)
        : undefined,
    digitalMaxDownloads: kind === "DIGITAL" && typeof digitalMaxDownloads === "number" ? Math.max(1, Math.trunc(digitalMaxDownloads)) : undefined,
    digitalLinkExpiryDays: kind === "DIGITAL" && typeof digitalLinkExpiryDays === "number" ? Math.max(1, Math.trunc(digitalLinkExpiryDays)) : undefined,
  }).go();
  const { data: product } = await CommerceProduct.get({ templateId, id: productId }).go();
  if (!product) throw new Error(`CommerceProduct ${productId} vanished immediately after being created`);

  if (Array.isArray(relatedProductIds) && relatedProductIds.length > 0) {
    const { data: candidateProducts } = await CommerceProduct.query.primary({ templateId }).go();
    const validIds = candidateProducts.filter((p) => relatedProductIds.includes(p.id)).map((p) => p.id);
    await Promise.all(
      validIds.map((relatedProductId) =>
        CommerceProductRelation.create({ id: randomUUID(), templateId, organizationId, productId: product.id, relatedProductId }).go().catch((err) => {
          if (!isConditionalCheckFailure(err)) throw err; // already related — idempotent
        }),
      ),
    );
  }

  return NextResponse.json({ product: toPublicProduct(product) }, { status: 201 });
}

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}
