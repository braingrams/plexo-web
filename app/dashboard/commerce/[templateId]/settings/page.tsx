import { maskSecret } from "@/lib/commerce/adminAuthDynamo";
import { decryptPaystackKey, decryptMaildripKey, tryDecrypt } from "@/lib/crypto";
import { hasProductDetailMarker } from "@/lib/commerce/productDetailLayout";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { Template } from "@/lib/db/contentEntities";
import { SettingsClient } from "./SettingsClient";

export default async function CommerceSettingsPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  const { data: productDetailTemplate } = settings?.productDetailTemplateId
    ? await Template.get({ id: settings.productDetailTemplateId }).go()
    : { data: null };

  return (
    <SettingsClient
      templateId={templateId}
      initial={{
        enabled: settings?.enabled ?? false,
        paymentProvider: settings?.paymentProvider ?? "BYO_PAYSTACK",
        paystackMode: settings?.paystackMode ?? "TEST",
        paystackTestPublicKey: settings?.paystackTestPublicKey ?? "",
        paystackLivePublicKey: settings?.paystackLivePublicKey ?? "",
        paystackTestSecretKeyMasked: settings?.paystackTestSecretKeyEncrypted ? maskSecret(tryDecrypt(() => decryptPaystackKey(settings.paystackTestSecretKeyEncrypted!))) : null,
        paystackLiveSecretKeyMasked: settings?.paystackLiveSecretKeyEncrypted ? maskSecret(tryDecrypt(() => decryptPaystackKey(settings.paystackLiveSecretKeyEncrypted!))) : null,
        maildripApiKeyMasked: settings?.maildripApiKeyEncrypted ? maskSecret(tryDecrypt(() => decryptMaildripKey(settings.maildripApiKeyEncrypted!))) : null,
        maildripPaidGroupId: settings?.maildripPaidGroupId ?? "",
        maildripNewsletterGroupId: settings?.maildripNewsletterGroupId ?? "",
        notificationEmail: settings?.notificationEmail ?? "",
        productDetailLayout: productDetailTemplate
          ? { templateId: productDetailTemplate.id, ready: hasProductDetailMarker(productDetailTemplate.compiledHtml) }
          : null,
      }}
    />
  );
}
