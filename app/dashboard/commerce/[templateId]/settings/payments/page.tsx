import { redirectToShopIfV3 } from "@/lib/dashboardV3/hubRedirect";
import { PaymentsSettingsContent } from "./Content";

export default async function CommercePaymentsSettingsPage({ params, searchParams }: { params: Promise<{ templateId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { templateId } = await params;
  await redirectToShopIfV3(templateId, "settings:payments", (await searchParams)?.classic);
  return <PaymentsSettingsContent templateId={templateId} />;
}
