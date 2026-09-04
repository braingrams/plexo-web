import { requireCustomContentPageAccess } from "@/lib/customContent/adminAuthDynamo";
import { CustomContentType, CustomContentEntry } from "@/lib/db/customContentEntities";
import { ContentTypesClient, type ContentTypeSummary } from "./ContentTypesClient";

/**
 * /dashboard/templates/[id]/content-types — the "define your own structured content" dashboard
 * (ACF/CPT-UI equivalent). Auth + ownership check follows the same requireXAccess shape
 * app/dashboard/templates/[id]/form-submissions/page.tsx (requireSiteLayoutAccess) and
 * site-layout/page.tsx use.
 */
export default async function ContentTypesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: templateId } = await params;
  const access = await requireCustomContentPageAccess(templateId, `/dashboard/templates/${templateId}/content-types`);

  const { data: contentTypes } = await CustomContentType.query.primary({ templateId }).go();
  contentTypes.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const entryCounts = await Promise.all(
    contentTypes.map((ct) => CustomContentEntry.query.primary({ contentTypeId: ct.id }).go()),
  );

  const initialContentTypes: ContentTypeSummary[] = contentTypes.map((ct, i) => ({
    id: ct.id,
    name: ct.name,
    slug: ct.slug,
    fields: Array.isArray(ct.fields) ? ct.fields : [],
    entryCount: entryCounts[i].data.length,
    createdAt: ct.createdAt ?? new Date().toISOString(),
  }));

  return <ContentTypesClient templateId={templateId} templateName={access.templateName} initialContentTypes={initialContentTypes} />;
}
