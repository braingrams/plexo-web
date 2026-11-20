import { redirectToShopIfV3 } from "@/lib/dashboardV3/hubRedirect";
import { GeneralSettingsContent } from "./Content";

export default async function CommerceGeneralSettingsPage({ params, searchParams }: { params: Promise<{ templateId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { templateId } = await params;
  await redirectToShopIfV3(templateId, "settings:general", (await searchParams)?.classic);
  return <GeneralSettingsContent templateId={templateId} />;
}
