import { requireSiteLayoutAccess } from "@/lib/siteLayout";
import { TransferSiteClient } from "./TransferSiteClient";

export default async function TransferSitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSiteLayoutAccess(id, `/dashboard/templates/${id}/transfer`);

  return <TransferSiteClient templateId={access.templateId} siteName={access.templateName} />;
}
