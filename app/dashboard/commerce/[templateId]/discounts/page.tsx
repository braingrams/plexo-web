import { CommerceDiscountCode, CommerceSettings } from "@/lib/db/commerceEntities";
import { DiscountsClient, type DiscountSummary } from "./DiscountsClient";

export default async function CommerceDiscountsPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;

  const [{ data: discounts }, { data: settings }] = await Promise.all([
    CommerceDiscountCode.query.primary({ templateId }).go(),
    CommerceSettings.get({ templateId }).go(),
  ]);
  discounts.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const initialDiscounts: DiscountSummary[] = discounts.map((d) => ({
    id: d.id,
    code: d.code,
    type: d.type,
    value: d.value,
    active: d.active ?? true,
    expiresAt: d.expiresAt ?? null,
    usageLimit: d.usageLimit ?? null,
    usedCount: d.usedCount ?? 0,
    createdAt: d.createdAt ?? new Date().toISOString(),
  }));

  return <DiscountsClient templateId={templateId} initialDiscounts={initialDiscounts} currency={settings?.currency ?? "NGN"} />;
}
