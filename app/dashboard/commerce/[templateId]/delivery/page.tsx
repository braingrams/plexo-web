import { redirectToShopIfV3 } from "@/lib/dashboardV3/hubRedirect";
import { DeliveryContent } from "./Content";

export default async function CommerceDeliveryPage({ params, searchParams }: { params: Promise<{ templateId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { templateId } = await params;
  await redirectToShopIfV3(templateId, "delivery", (await searchParams)?.classic);
  return <DeliveryContent templateId={templateId} />;
}
