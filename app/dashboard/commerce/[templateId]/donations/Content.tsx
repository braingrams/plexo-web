import { listDonationsOverview } from "@/lib/commerce/donations";
import { DonationsClient } from "./DonationsClient";
import { DonationsPanel } from "@/app/dashboard/_v3/hub/shop/DonationsPanel";

export async function DonationsContent({ templateId, hub }: { templateId: string; hub?: boolean }) {
  const overview = await listDonationsOverview(templateId, { allGifts: true });
  return hub ? <DonationsPanel templateId={templateId} initial={overview} /> : <DonationsClient templateId={templateId} initial={overview} />;
}
