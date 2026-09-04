import { CommerceDeliveryMethod, CommerceSettings } from "@/lib/db/commerceEntities";
import { DeliveryClient, type DeliveryMethodSummary } from "./DeliveryClient";

export default async function CommerceDeliveryPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;

  const [{ data: methods }, { data: settings }] = await Promise.all([
    CommerceDeliveryMethod.query.primary({ templateId }).go(),
    CommerceSettings.get({ templateId }).go(),
  ]);
  methods.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

  const initialMethods: DeliveryMethodSummary[] = methods.map((m) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    feeMinor: m.feeMinor ?? 0,
    description: m.description ?? null,
    countries: m.countries ?? [],
    states: m.states ?? [],
    estimatedTimeLabel: m.estimatedTimeLabel ?? null,
    status: m.status ?? "ACTIVE",
  }));

  return <DeliveryClient templateId={templateId} initialMethods={initialMethods} currency={settings?.currency ?? "NGN"} />;
}
