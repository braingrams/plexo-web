import { prisma } from "@/server/prisma";
import { ProductsClient, type ProductSummary } from "./ProductsClient";

export default async function CommerceProductsPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;

  const products = await prisma.commerceProduct.findMany({
    where: { templateId },
    include: { category: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  const initialProducts: ProductSummary[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    kind: p.kind,
    priceMinor: p.priceMinor,
    currency: p.currency,
    stockQuantity: p.stockQuantity,
    durationMinutes: p.durationMinutes,
    imageUrl: p.imageUrl,
    galleryImageUrls: Array.isArray(p.galleryImageUrls) ? (p.galleryImageUrls as string[]) : [],
    active: p.active,
    category: p.category,
    createdAt: p.createdAt.toISOString(),
    digitalDeliveryMethod: p.digitalDeliveryMethod,
    digitalFileUrl: p.digitalFileUrl,
    digitalFileName: p.digitalFileName,
    digitalExternalUrl: p.digitalExternalUrl,
    digitalAccessInstructions: p.digitalAccessInstructions,
    hasDigitalAccessPassword: Boolean(p.digitalAccessPasswordEncrypted),
    digitalMaxDownloads: p.digitalMaxDownloads,
    digitalLinkExpiryDays: p.digitalLinkExpiryDays,
  }));

  return <ProductsClient templateId={templateId} initialProducts={initialProducts} />;
}
