import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { resolveCustomContentAdmin } from "@/lib/customContent/adminAuthDynamo";
import { normalizeFieldsInput } from "@/lib/customContent/fields";
import { CustomContentType, CustomContentEntry } from "@/lib/db/customContentEntities";
import { Member } from "@/lib/db/coreEntities";
import { slugify } from "@/lib/slugUtils";

/**
 * PATCH /api/v1/templates/:id/content-types/:typeId
 *
 * Renames a content type, edits its slug, and/or replaces its field schema. Editing `fields`
 * does NOT retroactively touch existing CustomContentEntry rows — an entry created under an
 * older field set can end up with stray keys (a since-removed field) or missing ones (a newly-
 * added field), same "schema evolves, old rows don't get rewritten" tradeoff every schemaless-JSON
 * entity in this migration already has (Template.designJson, CommerceOrder.metadata, etc.). The
 * entries API's own validation only applies going forward, to entries actually being written.
 */
export async function PATCH(
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

  const { data: existing } = await CustomContentType.get({ templateId, id: typeId }).go();
  if (!existing) return NextResponse.json({ error: "Content type not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { name: rawName, slug: rawSlug, fields: rawFields } = body;

  const data: Record<string, unknown> = {};

  if (rawName !== undefined) {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) return NextResponse.json({ error: "name can't be empty." }, { status: 400 });
    data.name = name;
  }

  if (rawSlug !== undefined) {
    const slug = slugify(typeof rawSlug === "string" ? rawSlug : "");
    if (!slug) return NextResponse.json({ error: "slug can't be empty." }, { status: 400 });
    if (slug !== existing.slug) {
      const { data: siblings } = await CustomContentType.query.primary({ templateId }).go();
      if (siblings.some((ct) => ct.id !== typeId && ct.slug === slug)) {
        return NextResponse.json({ error: `A content type with slug "${slug}" already exists for this site.` }, { status: 409 });
      }
    }
    data.slug = slug;
  }

  if (rawFields !== undefined) {
    const normalizedFields = normalizeFieldsInput(rawFields);
    if ("error" in normalizedFields) {
      return NextResponse.json({ error: normalizedFields.error }, { status: 400 });
    }
    data.fields = normalizedFields.fields;
  }

  if (Object.keys(data).length > 0) {
    await CustomContentType.patch({ templateId, id: typeId }).set(data).go();
  }
  const { data: contentType } = await CustomContentType.get({ templateId, id: typeId }).go();

  return NextResponse.json({ contentType });
}

/**
 * DELETE /api/v1/templates/:id/content-types/:typeId
 *
 * Deletes a content type AND every entry under it — same "fan out and delete" cascade shape
 * app/api/v1/templates/[id]/route.ts's own DELETE uses for a template's descendant pages/assets/
 * domains (no DynamoDB equivalent of Prisma's onDelete: Cascade), just a sequential fan-out over
 * a per-type entry list rather than a full descendant-tree walk.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; typeId: string }> },
): Promise<NextResponse> {
  const { id: templateId, typeId } = await context.params;
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

  const { data: existing } = await CustomContentType.get({ templateId, id: typeId }).go();
  if (!existing) return NextResponse.json({ error: "Content type not found." }, { status: 404 });

  const { data: entries } = await CustomContentEntry.query.primary({ contentTypeId: typeId }).go();
  await Promise.all(entries.map((entry) => CustomContentEntry.remove({ contentTypeId: typeId, id: entry.id }).go()));

  await CustomContentType.remove({ templateId, id: typeId }).go();

  return NextResponse.json({ deleted: true, deletedEntryCount: entries.length });
}
