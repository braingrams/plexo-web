import { requireSiteLayoutAccess } from "@/lib/siteLayoutDynamo";
import { TransferSiteClient } from "./TransferSiteClient";
import { SiteToolBack } from "@/app/dashboard/_v3/page/SiteToolBack";

export default async function TransferSitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSiteLayoutAccess(id, `/dashboard/templates/${id}/transfer`);

  return (
    <>
    <SiteToolBack siteId={access.templateId} tab="settings" />
      <TransferSiteClient templateId={access.templateId} siteName={access.templateName} />
    </>
  );
}
