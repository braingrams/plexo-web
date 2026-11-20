import { redirectToShopIfV3 } from "@/lib/dashboardV3/hubRedirect";
import { DonationsContent } from "./Content";

export default async function CommerceDonationsPage({ params, searchParams }: { params: Promise<{ templateId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { templateId } = await params;
  await redirectToShopIfV3(templateId, "donations", (await searchParams)?.classic);
  return <DonationsContent templateId={templateId} />;
}
