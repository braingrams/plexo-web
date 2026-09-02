import { resolveActivePaystackKeys } from "@/lib/commerce/paystack";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { CustomersClient } from "./CustomersClient";

export default async function CommerceCustomersPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  const paystackConfigured = settings
    ? Boolean(
        resolveActivePaystackKeys({
          paystackMode: settings.paystackMode ?? "TEST",
          paystackTestPublicKey: settings.paystackTestPublicKey ?? null,
          paystackTestSecretKeyEncrypted: settings.paystackTestSecretKeyEncrypted ?? null,
          paystackLivePublicKey: settings.paystackLivePublicKey ?? null,
          paystackLiveSecretKeyEncrypted: settings.paystackLiveSecretKeyEncrypted ?? null,
        }).secretKeyEncrypted,
      )
    : false;

  return <CustomersClient templateId={templateId} paystackConfigured={paystackConfigured} />;
}
