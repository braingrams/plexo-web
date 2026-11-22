import { redirectToShopIfV3 } from "@/lib/dashboardV3/hubRedirect";
import { AvailabilityContent } from "./Content";

export default async function CommerceAvailabilityPage({ params, searchParams }: { params: Promise<{ templateId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { templateId } = await params;
  await redirectToShopIfV3(templateId, "availability", (await searchParams)?.classic);
  return <AvailabilityContent templateId={templateId} />;
}
