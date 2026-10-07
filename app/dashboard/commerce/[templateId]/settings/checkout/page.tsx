import { CommerceSettings } from "@/lib/db/commerceEntities";
import { readCheckoutFields } from "@/lib/commerce/checkoutFields";
import { CheckoutSettingsClient } from "./CheckoutSettingsClient";

export default async function CommerceCheckoutSettingsPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  return <CheckoutSettingsClient templateId={templateId} initialFields={readCheckoutFields(settings?.checkoutFields)} />;
}
