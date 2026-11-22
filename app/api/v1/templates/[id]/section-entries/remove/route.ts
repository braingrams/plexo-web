import { NextRequest, NextResponse } from "next/server";
import { resolveSectionAdmin } from "@/lib/customSections/auth";
import { removeEntries } from "@/lib/customSections/entries";

/** POST { items: [{ pageId, sectionId }] } — takes these uses of a section off their pages (the section's design stays available). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const r = await resolveSectionAdmin(request, id, true);
  if ("error" in r) return r.error;
  const body = (await request.json().catch(() => ({}))) as { items?: unknown };
  const items = Array.isArray(body.items) ? body.items.filter((i): i is { pageId: string; sectionId: string } => !!i && typeof (i as { pageId?: unknown }).pageId === "string" && typeof (i as { sectionId?: unknown }).sectionId === "string") : [];
  if (items.length === 0) return NextResponse.json({ error: "Choose at least one to remove." }, { status: 400 });
  const out = await removeEntries(r.admin.siteId, r.admin.organizationId, items);
  return NextResponse.json(out);
}
