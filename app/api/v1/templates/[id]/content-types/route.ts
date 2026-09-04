import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { resolveCustomContentAdmin } from "@/lib/customContent/adminAuthDynamo";
import { normalizeFieldsInput } from "@/lib/customContent/fields";
import { CustomContentType, CustomContentEntry } from "@/lib/db/customContentEntities";
import { Member } from "@/lib/db/coreEntities";
import { slugify } from "@/lib/slugUtils";

/**
 * GET /api/v1/templates/:id/content-types
 *
 * Lists every custom content type defined for this site/page, newest first, along with each
 * type's entry count — the dashboard list needs both without a second round trip per row. Entry
 * counts are computed by fanning out one query per type (bounded by how many content types a
 * site actually has, which is small and owner-curated, same "small in practice" discipline as
 * app/api/public/commerce/products/route.ts's bestSellerProductIds).
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: templateId } = await context.params;
  const resolved = await resolveCustomContentAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const { data: contentTypes } = await CustomContentType.query.primary({ templateId }).go();
  contentTypes.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const entryCounts = await Promise.all(
    contentTypes.map((ct) => CustomContentEntry.query.primary({ contentTypeId: ct.id }).go()),
  );

  const result = contentTypes.map((ct, i) => ({
    id: ct.id,
    templateId: ct.templateId,
    name: ct.name,
    slug: ct.slug,
    fields: ct.fields,
    entryCount: entryCounts[i].data.length,
    createdAt: ct.createdAt,
    updatedAt: ct.updatedAt,
  }));

  return NextResponse.json({ contentTypes: result });
}

/**
 * POST /api/v1/templates/:id/content-types
 *
 * Defines a new custom content type (name + a field schema) for this site/page — the ACF/CPT-UI
 * "add new content type" equivalent. slug is auto-derived from name (slugify(), same helper every
 * other slug in this app uses) unless explicitly supplied, and must be unique among this
 * template's own content types — enforced here with a find-before-create check against the (small,
 * per-site) existing list, since this entity deliberately has no GSI to enforce it for free (see
 * lib/db/customContentEntities.ts's header comment).
 *
 * Payload:
 * {
 *   "name": "Testimonial",
 *   "slug": "testimonial" (optional, derived from name if omitted),
 *   "fields": [{ "name": "Quote", "key": "quote" (optional), "type": "textarea", "required": true }, ...]
 * }
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: templateId } = await context.params;
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

  const body = await request.json().catch(() => ({}));
  const { name: rawName, slug: rawSlug, fields: rawFields } = body;

  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "A name is required." }, { status: 400 });
  }

  const slug = slugify(typeof rawSlug === "string" && rawSlug.trim() ? rawSlug : name);
  if (!slug) {
    return NextResponse.json({ error: "Could not derive a valid slug — use a name with at least one letter or number." }, { status: 400 });
  }

  const normalizedFields = normalizeFieldsInput(rawFields);
  if ("error" in normalizedFields) {
    return NextResponse.json({ error: normalizedFields.error }, { status: 400 });
  }

  const { data: existing } = await CustomContentType.query.primary({ templateId }).go();
  if (existing.some((ct) => ct.slug === slug)) {
    return NextResponse.json({ error: `A content type with slug "${slug}" already exists for this site.` }, { status: 409 });
  }

  const id = randomUUID();
  await CustomContentType.create({
    id,
    templateId,
    organizationId,
    name,
    slug,
    fields: normalizedFields.fields,
  }).go();
  const { data: contentType } = await CustomContentType.get({ templateId, id }).go();

  return NextResponse.json({ contentType }, { status: 201 });
}
