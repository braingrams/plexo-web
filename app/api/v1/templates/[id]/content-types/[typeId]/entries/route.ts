import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { resolveCustomContentAdmin } from "@/lib/customContent/adminAuthDynamo";
import { validateEntryData } from "@/lib/customContent/fields";
import { CustomContentType, CustomContentEntry } from "@/lib/db/customContentEntities";
import type { CustomContentField } from "@/lib/db/customContentEntities";
import { Member } from "@/lib/db/coreEntities";

/**
 * GET /api/v1/templates/:id/content-types/:typeId/entries
 *
 * Lists every entry (draft and published) under this content type, newest first — the
 * dashboard's own entries list. There's no status filter here (unlike the public read API,
 * which only ever returns PUBLISHED) since the dashboard owner needs to see drafts too.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; typeId: string }> },
): Promise<NextResponse> {
  const { id: templateId, typeId } = await context.params;
  const resolved = await resolveCustomContentAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const { data: contentType } = await CustomContentType.get({ templateId, id: typeId }).go();
  if (!contentType) return NextResponse.json({ error: "Content type not found." }, { status: 404 });

  const { data: entries } = await CustomContentEntry.query.primary({ contentTypeId: typeId }).go();
  entries.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  return NextResponse.json({ contentType: { id: contentType.id, name: contentType.name, slug: contentType.slug, fields: contentType.fields }, entries });
}

/**
 * POST /api/v1/templates/:id/content-types/:typeId/entries
 *
 * Creates a new entry under this content type. `data` is validated against the content type's
 * own `fields` schema (unknown keys rejected, `required` enforced, values type-checked) —
 * see lib/customContent/fields.ts's validateEntryData.
 *
 * Payload: { "data": { "<fieldKey>": <value>, ... }, "status": "DRAFT" | "PUBLISHED" (optional, defaults to DRAFT) }
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; typeId: string }> },
): Promise<NextResponse> {
  const { id: templateId, typeId } = await context.params;
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

  const body = await request.json().catch(() => ({}));
  const { data: rawData, status: rawStatus } = body;

  const fields = (Array.isArray(contentType.fields) ? contentType.fields : []) as CustomContentField[];
  const validated = validateEntryData(fields, rawData ?? {});
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const status = rawStatus === "PUBLISHED" ? "PUBLISHED" : "DRAFT";

  const id = randomUUID();
  await CustomContentEntry.create({
    id,
    templateId,
    contentTypeId: typeId,
    organizationId,
    data: validated.data,
    status,
  }).go();
  const { data: entry } = await CustomContentEntry.get({ contentTypeId: typeId, id }).go();

  return NextResponse.json({ entry }, { status: 201 });
}
