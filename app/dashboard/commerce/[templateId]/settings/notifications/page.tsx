import { CommerceSettings } from "@/lib/db/commerceEntities";
import { NotificationsSettingsClient } from "./NotificationsSettingsClient";

export default async function CommerceNotificationsSettingsPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const { data: settings } = await CommerceSettings.get({ templateId }).go();

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
        notificationEmail: settings?.notificationEmail ?? "",
      }}
    />
  );
}
