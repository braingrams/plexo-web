import { maskSecret } from "@/lib/commerce/adminAuthDynamo";
import { decryptPaystackKey, decryptStripeKey, tryDecrypt } from "@/lib/crypto";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { PaymentsSettingsClient } from "./PaymentsSettingsClient";

export default async function CommercePaymentsSettingsPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const { data: settings } = await CommerceSettings.get({ templateId }).go();

  return (
    <PaymentsSettingsClient
      templateId={templateId}
      initial={{
        paymentProvider: settings?.paymentProvider ?? "BYO_PAYSTACK",
        paystackMode: settings?.paystackMode ?? "TEST",
        paystackTestPublicKey: settings?.paystackTestPublicKey ?? "",
        paystackLivePublicKey: settings?.paystackLivePublicKey ?? "",
        paystackTestSecretKeyMasked: settings?.paystackTestSecretKeyEncrypted
          ? maskSecret(tryDecrypt(() => decryptPaystackKey(settings.paystackTestSecretKeyEncrypted!)))
          : null,
        paystackLiveSecretKeyMasked: settings?.paystackLiveSecretKeyEncrypted
          ? maskSecret(tryDecrypt(() => decryptPaystackKey(settings.paystackLiveSecretKeyEncrypted!)))
          : null,
        stripeMode: settings?.stripeMode ?? "TEST",
        stripeTestPublishableKey: settings?.stripeTestPublishableKey ?? "",
        stripeLivePublishableKey: settings?.stripeLivePublishableKey ?? "",
        stripeTestSecretKeyMasked: settings?.stripeTestSecretKeyEncrypted
          ? maskSecret(tryDecrypt(() => decryptStripeKey(settings.stripeTestSecretKeyEncrypted!)))
          : null,
        stripeLiveSecretKeyMasked: settings?.stripeLiveSecretKeyEncrypted
          ? maskSecret(tryDecrypt(() => decryptStripeKey(settings.stripeLiveSecretKeyEncrypted!)))
          : null,
        stripeTestWebhookSecretMasked: settings?.stripeTestWebhookSecretEncrypted
          ? maskSecret(tryDecrypt(() => decryptStripeKey(settings.stripeTestWebhookSecretEncrypted!)))
          : null,
        stripeLiveWebhookSecretMasked: settings?.stripeLiveWebhookSecretEncrypted
          ? maskSecret(tryDecrypt(() => decryptStripeKey(settings.stripeLiveWebhookSecretEncrypted!)))
          : null,
      }}
    />
  );
}
