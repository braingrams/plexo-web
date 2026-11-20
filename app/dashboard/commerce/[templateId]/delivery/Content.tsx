import { CommerceDeliveryMethod, CommerceSettings } from "@/lib/db/commerceEntities";
import { resolveFulfillmentOptions } from "@/lib/commerce/delivery";
import { DeliveryClient, type DeliveryMethodSummary } from "./DeliveryClient";

export async function DeliveryContent({ templateId }: { templateId: string }) {

  const [{ data: methods }, { data: settings }] = await Promise.all([
    CommerceDeliveryMethod.query.primary({ templateId }).go({ pages: "all" }),
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

  return (
    <DeliveryClient
      templateId={templateId}
      initialMethods={initialMethods}
      currency={settings?.currency ?? "NGN"}
      initialFulfillment={resolveFulfillmentOptions(settings)}
    />
  );
}
