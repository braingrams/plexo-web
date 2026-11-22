import { CommerceSettings } from "@/lib/db/commerceEntities";
import { NotificationsSettingsClient } from "./NotificationsSettingsClient";
import { EmailsPanel } from "@/app/dashboard/_v3/hub/shop/EmailsPanel";
import { Template } from "@/lib/db/contentEntities";

export async function NotificationsSettingsContent({ templateId, hub }: { templateId: string; hub?: boolean }) {
  const { data: settings } = await CommerceSettings.get({ templateId }).go();

  const mailing = {
    maildripConnected: Boolean(settings?.maildripApiKeyEncrypted),
    maildripPaidGroupId: settings?.maildripPaidGroupId ?? "",
    maildripNewsletterGroupId: settings?.maildripNewsletterGroupId ?? "",
    newsletterPopupEnabled: settings?.newsletterPopupEnabled ?? false,
    notificationEmail: settings?.notificationEmail ?? "",
  };
  if (hub) {
    const { data: site } = await Template.get({ id: templateId }).go();
    const flag = (v: boolean | undefined) => v ?? true;
    return (
      <EmailsPanel
        templateId={templateId}
        initial={{
          shopName: site?.name ?? "",
          flags: { Paid: flag(settings?.notifyCustomerOnPaid), Processing: flag(settings?.notifyCustomerOnProcessing), ReadyForPickup: flag(settings?.notifyCustomerOnReadyForPickup), Shipped: flag(settings?.notifyCustomerOnShipped), Completed: flag(settings?.notifyCustomerOnCompleted), Refunded: flag(settings?.notifyCustomerOnRefunded) },
          mailing,
        }}
      />
    );
  }
  return (
    <NotificationsSettingsClient
      templateId={templateId}
      initial={{
        // The raw key is never shown once connected — the connect flow (below) hands it
        // straight to CommerceSettings server-side, so a plain "connected or not" flag is
        // all the client needs (no reason to spend a decrypt on a value we don't display).
        maildripConnected: Boolean(settings?.maildripApiKeyEncrypted),
        maildripPaidGroupId: settings?.maildripPaidGroupId ?? "",
        maildripNewsletterGroupId: settings?.maildripNewsletterGroupId ?? "",
        newsletterPopupEnabled: settings?.newsletterPopupEnabled ?? false,
        notificationEmail: settings?.notificationEmail ?? "",
      }}
    />
  );
}
