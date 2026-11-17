import { requireSiteLayoutAccess } from "@/lib/siteLayoutDynamo";
import { SiteToolBack } from "@/app/dashboard/_v3/page/SiteToolBack";
import { SiteImportPageClient } from "./SiteImportPageClient";

/** Bring pages in from another website builder (Wix, Squarespace, Webflow, WordPress ...) into this site. */
export default async function SiteImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSiteLayoutAccess(id, `/dashboard/templates/${id}/site-import`);
  return (
    <>
      <SiteToolBack siteId={access.templateId} tab="pages" />
      <SiteImportPageClient templateId={access.templateId} siteName={access.templateName} />
    </>
  );
}
