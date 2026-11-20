import { notFound } from "next/navigation";
import { requireCustomContentPageAccess } from "@/lib/customContent/adminAuthDynamo";
import { getSectionType, siteIdForTemplate } from "@/lib/customSections/service";
import { Template } from "@/lib/db/contentEntities";
import { SectionTypeEditor } from "./SectionTypeEditor";

/** /dashboard/templates/[id]/sections/new, or .../sections/<section id> to change a section's design. */
export default async function SectionTypePage({ params }: { params: Promise<{ id: string; typeId: string }> }) {
  const { id, typeId } = await params;
  const access = await requireCustomContentPageAccess(id, `/dashboard/templates/${id}/sections/${typeId}`);
  if (typeId === "new") return <SectionTypeEditor templateId={id} templateName={access.templateName} existing={null} />;
  const { data: template } = await Template.get({ id }).go();
  const existing = await getSectionType(await siteIdForTemplate(template!), typeId);
  if (!existing) notFound();
  return <SectionTypeEditor templateId={id} templateName={access.templateName} existing={existing} />;
}
