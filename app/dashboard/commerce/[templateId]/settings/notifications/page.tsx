import { redirectToShopIfV3 } from "@/lib/dashboardV3/hubRedirect";
import { NotificationsSettingsContent } from "./Content";

export default async function CommerceNotificationsSettingsPage({ params, searchParams }: { params: Promise<{ templateId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { templateId } = await params;
  await redirectToShopIfV3(templateId, "settings:notifications", (await searchParams)?.classic);
  return <NotificationsSettingsContent templateId={templateId} />;
}
