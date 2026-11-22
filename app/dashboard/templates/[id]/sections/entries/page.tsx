import { requireCustomContentPageAccess } from "@/lib/customContent/adminAuthDynamo";
import { siteIdForTemplate } from "@/lib/customSections/service";
import { Template } from "@/lib/db/contentEntities";
import { SiteToolBack } from "@/app/dashboard/_v3/page/SiteToolBack";
import { EntriesClient } from "./EntriesClient";

/** /dashboard/templates/[id]/sections/entries — every place the site's own sections are used, with edit-in-place. */
export default async function EntriesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ type?: string }> }) {
  const { id } = await params;
  const { type } = await searchParams;
  const access = await requireCustomContentPageAccess(id, `/dashboard/templates/${id}/sections/entries`);
  const { data: template } = await Template.get({ id }).go();
  const siteId = await siteIdForTemplate(template!);
  return (
    <>
      <SiteToolBack siteId={siteId} tab="settings" />
      <EntriesClient templateId={id} templateName={access.templateName} initialType={type ?? ""} />
    </>
  );
}
