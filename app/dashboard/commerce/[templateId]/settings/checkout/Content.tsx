import { CommerceSettings } from "@/lib/db/commerceEntities";
import { readCheckoutFields } from "@/lib/commerce/checkoutFields";
import { CheckoutSettingsClient } from "./CheckoutSettingsClient";
import { CheckoutPanel } from "@/app/dashboard/_v3/hub/shop/CheckoutPanel";
import { Template } from "@/lib/db/contentEntities";
import { resolveFulfillmentOptions } from "@/lib/commerce/delivery";

export async function CheckoutSettingsContent({ templateId, hub }: { templateId: string; hub?: boolean }) {
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  if (hub) {
    const { data: site } = await Template.get({ id: templateId }).go();
    const f = resolveFulfillmentOptions(settings);
    return <CheckoutPanel templateId={templateId} initial={{ fields: readCheckoutFields(settings?.checkoutFields), deliveryEnabled: f.deliveryEnabled, pickupEnabled: f.pickupEnabled, pickupLocation: f.pickupLocation, pickupInstructions: f.pickupInstructions, termsText: settings?.termsText ?? null, termsUrl: settings?.termsUrl ?? null, shopName: site?.name ?? "", contactEmail: settings?.notificationEmail ?? "" }} />;
  }
  return <CheckoutSettingsClient templateId={templateId} initialFields={readCheckoutFields(settings?.checkoutFields)} />;
}
