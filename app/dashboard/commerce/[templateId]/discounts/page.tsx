import { prisma } from "@/server/prisma";
import { DiscountsClient, type DiscountSummary } from "./DiscountsClient";

export default async function CommerceDiscountsPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;

  const discounts = await prisma.commerceDiscountCode.findMany({ where: { templateId }, orderBy: { createdAt: "desc" } });

  const initialDiscounts: DiscountSummary[] = discounts.map((d) => ({
    id: d.id,
    code: d.code,
    type: d.type,
    value: d.value,
    active: d.active,
    expiresAt: d.expiresAt ? d.expiresAt.toISOString() : null,
    usageLimit: d.usageLimit,
    usedCount: d.usedCount,
    createdAt: d.createdAt.toISOString(),
  }));

  return <DiscountsClient templateId={templateId} initialDiscounts={initialDiscounts} />;
}
