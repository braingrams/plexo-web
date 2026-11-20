import { NextRequest, NextResponse } from "next/server";
import { resolveSectionAdmin } from "@/lib/customSections/auth";
import { normalizeSectionTypeInput } from "@/lib/customSections/model";
import { applySectionTypeToPages, deleteSectionType, getSectionType, updateSectionType } from "@/lib/customSections/service";

type Ctx = { params: Promise<{ id: string; typeId: string }> };

export async function GET(request: NextRequest, context: Ctx): Promise<NextResponse> {
  const { id, typeId } = await context.params;
  const r = await resolveSectionAdmin(request, id, false);
  if ("error" in r) return r.error;
  const sectionType = await getSectionType(r.admin.siteId, typeId);
  if (!sectionType) return NextResponse.json({ error: "We couldn't find that section." }, { status: 404 });
  return NextResponse.json({ sectionType });
}

/**
 * PATCH /api/v1/templates/:id/section-types/:typeId — changes the design, fields, name or starting content. The design is
 * shared: every page already using this section is redrawn with it (each keeps its own words), and `pagesUpdated` says how many.
 */
export async function PATCH(request: NextRequest, context: Ctx): Promise<NextResponse> {
  const { id, typeId } = await context.params;
  const r = await resolveSectionAdmin(request, id, true);
  if ("error" in r) return r.error;
  const existing = await getSectionType(r.admin.siteId, typeId);
  if (!existing) return NextResponse.json({ error: "We couldn't find that section." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const input = normalizeSectionTypeInput(body, existing);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });
  const sectionType = await updateSectionType(r.admin.siteId, typeId, input.value);
  const designChanged = existing.html !== sectionType.html || JSON.stringify(existing.fields) !== JSON.stringify(sectionType.fields) || existing.name !== sectionType.name;
  const pagesUpdated = designChanged ? await applySectionTypeToPages(r.admin.siteId, [sectionType]) : 0;
  return NextResponse.json({ sectionType, pagesUpdated });
}

/** DELETE — removes it from the picker. Pages already using it keep what they show. */
export async function DELETE(request: NextRequest, context: Ctx): Promise<NextResponse> {
  const { id, typeId } = await context.params;
  const r = await resolveSectionAdmin(request, id, true);
  if ("error" in r) return r.error;
  const existing = await getSectionType(r.admin.siteId, typeId);
  if (!existing) return NextResponse.json({ error: "We couldn't find that section." }, { status: 404 });
  await deleteSectionType(r.admin.siteId, typeId);
  return NextResponse.json({ ok: true });
}
