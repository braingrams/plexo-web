import { requireCustomContentPageAccess } from "@/lib/customContent/adminAuthDynamo";
import { listSectionTypes, siteIdForTemplate } from "@/lib/customSections/service";
import { Template } from "@/lib/db/contentEntities";
import { SiteToolBack } from "@/app/dashboard/_v3/page/SiteToolBack";
import { SectionsClient, type SectionTypeSummary } from "./SectionsClient";

/** /dashboard/templates/[id]/sections — the section types this site can add to any page. */
export default async function SectionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireCustomContentPageAccess(id, `/dashboard/templates/${id}/sections`);
  const { data: template } = await Template.get({ id }).go();
  const siteId = await siteIdForTemplate(template!);
  const types = await listSectionTypes(siteId, access.organizationId);
  const initial: SectionTypeSummary[] = types.map((t) => {
    const list = t.fields.find((f) => f.type === "list");
    return { id: t.id, name: t.name, description: t.description, starter: t.starter, fieldCount: t.fields.length, repeats: list?.itemName };
  });
  return (
    <>
      <SiteToolBack siteId={siteId} tab="settings" />
      <SectionsClient templateId={id} templateName={access.templateName} initial={initial} />
    </>
  );
}
