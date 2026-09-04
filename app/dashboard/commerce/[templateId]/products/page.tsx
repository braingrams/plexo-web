import { CommerceProduct, CommerceCategory, CommerceSettings } from "@/lib/db/commerceEntities";
import { ProductsClient, type ProductSummary } from "./ProductsClient";

export default async function CommerceProductsPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;

  const [{ data: products }, { data: categories }, { data: settings }] = await Promise.all([
    CommerceProduct.query.primary({ templateId }).go(),
    CommerceCategory.query.primary({ templateId }).go(),
    CommerceSettings.get({ templateId }).go(),
  ]);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const sorted = [...products].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  // Currency is site-wide (CommerceSettings.currency), not per-product — a product's own
  // `currency` attribute is a vestigial per-record default from before that decision and
  // is never read for display anymore.
  const currency = settings?.currency ?? "NGN";

  const initialProducts: ProductSummary[] = sorted.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description ?? null,
    kind: p.kind ?? "PHYSICAL",
    priceMinor: p.priceMinor,
    currency,
    stockQuantity: p.stockQuantity ?? null,
    durationMinutes: p.durationMinutes ?? null,
    imageUrl: p.imageUrl ?? null,
    galleryImageUrls: Array.isArray(p.galleryImageUrls) ? (p.galleryImageUrls as string[]) : [],
    active: p.active ?? true,
    category: p.categoryId && categoryById.has(p.categoryId) ? { id: p.categoryId, name: categoryById.get(p.categoryId)!.name } : null,
    createdAt: p.createdAt ?? new Date().toISOString(),
    digitalDeliveryMethod: p.digitalDeliveryMethod ?? null,
    digitalFileUrl: p.digitalFileUrl ?? null,
    digitalFileName: p.digitalFileName ?? null,
    digitalExternalUrl: p.digitalExternalUrl ?? null,
    digitalAccessInstructions: p.digitalAccessInstructions ?? null,
    hasDigitalAccessPassword: Boolean(p.digitalAccessPasswordEncrypted),
    digitalMaxDownloads: p.digitalMaxDownloads ?? null,
    digitalLinkExpiryDays: p.digitalLinkExpiryDays ?? null,
  }));

  return <ProductsClient templateId={templateId} initialProducts={initialProducts} currency={currency} />;
}
