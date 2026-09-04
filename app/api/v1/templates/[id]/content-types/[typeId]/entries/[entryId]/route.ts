import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { resolveCustomContentAdmin } from "@/lib/customContent/adminAuthDynamo";
import { validateEntryData } from "@/lib/customContent/fields";
import { CustomContentType, CustomContentEntry } from "@/lib/db/customContentEntities";
import type { CustomContentField } from "@/lib/db/customContentEntities";
import { Member } from "@/lib/db/coreEntities";

/**
 * PATCH /api/v1/templates/:id/content-types/:typeId/entries/:entryId
 *
 * Updates an entry's `data` (full replacement, re-validated against the content type's current
 * field schema — same "full replacement, not a merge" discipline as PUT /api/v1/templates/:id's
 * own designJson) and/or its `status`. Either can be supplied alone (e.g. a bare
 * { "status": "PUBLISHED" } to publish a draft without touching its data).
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; typeId: string; entryId: string }> },
): Promise<NextResponse> {
  const { id: templateId, typeId, entryId } = await context.params;
  const resolved = await resolveCustomContentAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, userId, role } = resolved.context;

  const permissionError = requirePermission(role, { template: ["update"] });
  if (permissionError) return permissionError;

  if (role !== null) {
    const { data: member } = await Member.get({ organizationId, userId }).go();
    const scopeError = requireTemplateScope(member, templateId);
    if (scopeError) return scopeError;
  }

  const { data: contentType } = await CustomContentType.get({ templateId, id: typeId }).go();
  if (!contentType) return NextResponse.json({ error: "Content type not found." }, { status: 404 });

  const { data: existing } = await CustomContentEntry.get({ contentTypeId: typeId, id: entryId }).go();
  if (!existing) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { data: rawData, status: rawStatus } = body;

  const patch: Record<string, unknown> = {};

  if (rawData !== undefined) {
    const fields = (Array.isArray(contentType.fields) ? contentType.fields : []) as CustomContentField[];
    const validated = validateEntryData(fields, rawData);
    if ("error" in validated) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    patch.data = validated.data;
  }

  if (rawStatus !== undefined) {
    if (rawStatus !== "PUBLISHED" && rawStatus !== "DRAFT") {
      return NextResponse.json({ error: "status must be PUBLISHED or DRAFT." }, { status: 400 });
    }
    patch.status = rawStatus;
  }

  if (Object.keys(patch).length > 0) {
    await CustomContentEntry.patch({ contentTypeId: typeId, id: entryId }).set(patch).go();
  }
  const { data: entry } = await CustomContentEntry.get({ contentTypeId: typeId, id: entryId }).go();

  return NextResponse.json({ entry });
}

/**
 * DELETE /api/v1/templates/:id/content-types/:typeId/entries/:entryId
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; typeId: string; entryId: string }> },
): Promise<NextResponse> {
  const { id: templateId, typeId, entryId } = await context.params;
  const resolved = await resolveCustomContentAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, userId, role } = resolved.context;

  const permissionError = requirePermission(role, { template: ["delete"] });
  if (permissionError) return permissionError;

  if (role !== null) {
    const { data: member } = await Member.get({ organizationId, userId }).go();
    const scopeError = requireTemplateScope(member, templateId);
    if (scopeError) return scopeError;
  }

  const { data: existing } = await CustomContentEntry.get({ contentTypeId: typeId, id: entryId }).go();
  if (!existing) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

  await CustomContentEntry.remove({ contentTypeId: typeId, id: entryId }).go();
  return NextResponse.json({ deleted: true });
}
