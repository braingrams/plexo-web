import { listDonationsOverview } from "@/lib/commerce/donations";
import { DonationsClient } from "./DonationsClient";

export default async function CommerceDonationsPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const overview = await listDonationsOverview(templateId, { allGifts: true });
  return <DonationsClient templateId={templateId} initial={overview} />;
}
