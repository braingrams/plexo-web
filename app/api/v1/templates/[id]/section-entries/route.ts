import { NextRequest, NextResponse } from "next/server";
import { resolveSectionAdmin } from "@/lib/customSections/auth";
import { siteEntries } from "@/lib/customSections/placements";
import { listSectionTypes } from "@/lib/customSections/service";

const MAX = 500;

/**
 * GET /api/v1/templates/:id/section-entries?typeId=&q= — every place a section type is used across the site's pages:
 * the page, the words that identify the use, how many repeated rows it has, and when the page last changed. `:id` can be any
 * page of the site. Without `typeId` it covers every section type; `types` always lists each type with its number of uses.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const r = await resolveSectionAdmin(request, id, false);
  if ("error" in r) return r.error;
  const types = await listSectionTypes(r.admin.siteId, r.admin.organizationId);
  const all = await siteEntries(r.admin.siteId, r.admin.organizationId, types);

  const typeId = request.nextUrl.searchParams.get("typeId")?.trim() || "";
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const counts = new Map<string, number>();
  for (const e of all) counts.set(e.typeId, (counts.get(e.typeId) ?? 0) + 1);

  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const matches = all
    .filter((e) => (!typeId || e.typeId === typeId) && (!q || `${e.keyText} ${e.pageTitle} ${typeName.get(e.typeId) ?? ""}`.toLowerCase().includes(q)))
    .sort((a, b) => b.editedAt.localeCompare(a.editedAt));
  return NextResponse.json({
    types: types.map((t) => ({ id: t.id, name: t.name, repeats: t.fields.find((f) => f.type === "list")?.itemName ?? null, count: counts.get(t.id) ?? 0 })),
    entries: matches.slice(0, MAX).map((e) => ({ ...e, typeName: typeName.get(e.typeId) ?? "" })),
    total: matches.length,
  });
}
