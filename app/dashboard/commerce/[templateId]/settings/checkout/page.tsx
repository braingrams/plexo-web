import { redirectToShopIfV3 } from "@/lib/dashboardV3/hubRedirect";
import { CheckoutSettingsContent } from "./Content";

export default async function CommerceCheckoutSettingsPage({ params, searchParams }: { params: Promise<{ templateId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { templateId } = await params;
  await redirectToShopIfV3(templateId, "settings:checkout", (await searchParams)?.classic);
  return <CheckoutSettingsContent templateId={templateId} />;
}
