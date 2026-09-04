import { notFound } from "next/navigation";
import { requireCustomContentPageAccess } from "@/lib/customContent/adminAuthDynamo";
import { CustomContentType, CustomContentEntry } from "@/lib/db/customContentEntities";
import type { CustomContentField } from "@/lib/db/customContentEntities";
import { EntriesClient, type EntrySummary } from "./EntriesClient";

/** First text-ish field's value, trimmed for a list preview — same idea as
 * form-submissions/page.tsx's findFieldByKeyword, just simpler: there's a real field schema
 * here (unlike a form's free-form fields), so this just walks it in declared order. */
function previewFor(fields: CustomContentField[], data: Record<string, unknown>): string {
  const textish = fields.filter((f) => f.type === "text" || f.type === "textarea" || f.type === "richtext");
  for (const field of textish) {
    const value = data[field.key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().length > 120 ? `${value.trim().slice(0, 120)}…` : value.trim();
    }
  }
  for (const field of fields) {
    const value = data[field.key];
    if (value !== undefined && value !== null && value !== "") {
      return String(value);
    }
  }
  return "(empty entry)";
}

export default async function EntriesPage({ params }: { params: Promise<{ id: string; typeId: string }> }) {
  const { id: templateId, typeId } = await params;
  const access = await requireCustomContentPageAccess(templateId, `/dashboard/templates/${templateId}/content-types/${typeId}/entries`);

  const { data: contentType } = await CustomContentType.get({ templateId, id: typeId }).go();
  if (!contentType) notFound();

  const fields = (Array.isArray(contentType.fields) ? contentType.fields : []) as CustomContentField[];

  const { data: entries } = await CustomContentEntry.query.primary({ contentTypeId: typeId }).go();
  entries.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  const initialEntries: EntrySummary[] = entries.map((e) => ({
    id: e.id,
    data: (e.data && typeof e.data === "object" ? (e.data as Record<string, unknown>) : {}),
    status: e.status ?? "DRAFT",
    preview: previewFor(fields, (e.data && typeof e.data === "object" ? (e.data as Record<string, unknown>) : {})),
    updatedAt: e.updatedAt ?? new Date().toISOString(),
  }));

  return (
    <EntriesClient
      templateId={templateId}
      templateName={access.templateName}
      contentType={{ id: contentType.id, name: contentType.name, slug: contentType.slug, fields }}
      initialEntries={initialEntries}
    />
  );
}
