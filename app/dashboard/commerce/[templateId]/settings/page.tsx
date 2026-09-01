import { prisma } from "@/server/prisma";
import { maskSecret } from "@/lib/commerce/adminAuth";
import { decryptPaystackKey, decryptMaildripKey } from "@/lib/crypto";
import { hasProductDetailMarker } from "@/lib/commerce/productDetailLayout";
import { SettingsClient } from "./SettingsClient";

export default async function CommerceSettingsPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const settings = await prisma.commerceSettings.findUnique({
    where: { templateId },
    include: { productDetailTemplate: { select: { id: true, compiledHtml: true } } },
  });

  return (
    <SettingsClient
      templateId={templateId}
      initial={{
        enabled: settings?.enabled ?? false,
        paymentProvider: settings?.paymentProvider ?? "BYO_PAYSTACK",
        paystackMode: settings?.paystackMode ?? "TEST",
        paystackTestPublicKey: settings?.paystackTestPublicKey ?? "",
        paystackLivePublicKey: settings?.paystackLivePublicKey ?? "",
        paystackTestSecretKeyMasked: settings?.paystackTestSecretKeyEncrypted ? maskSecret(decryptPaystackKey(settings.paystackTestSecretKeyEncrypted)) : null,
        paystackLiveSecretKeyMasked: settings?.paystackLiveSecretKeyEncrypted ? maskSecret(decryptPaystackKey(settings.paystackLiveSecretKeyEncrypted)) : null,
        maildripApiKeyMasked: settings?.maildripApiKeyEncrypted ? maskSecret(decryptMaildripKey(settings.maildripApiKeyEncrypted)) : null,
        maildripPaidGroupId: settings?.maildripPaidGroupId ?? "",
        maildripNewsletterGroupId: settings?.maildripNewsletterGroupId ?? "",
        notificationEmail: settings?.notificationEmail ?? "",
        productDetailLayout: settings?.productDetailTemplate
          ? { templateId: settings.productDetailTemplate.id, ready: hasProductDetailMarker(settings.productDetailTemplate.compiledHtml) }
          : null,
      }}
    />
  );
}
