import { NextRequest, NextResponse } from "next/server";
import { resolveSectionAdmin } from "@/lib/customSections/auth";
import { draftSectionType } from "@/lib/customSections/draft";

/**
 * POST /api/v1/templates/:id/section-types/draft { name?, description } — SOL proposes the fields, design and starting content
 * for a section described in plain words. Nothing is saved: the dashboard shows it in the preview and the owner decides.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const r = await resolveSectionAdmin(request, id, true);
  if ("error" in r) return r.error;
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; description?: unknown };
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length < 8) return NextResponse.json({ error: "Tell us a little more about what you're creating, for example “a menu with dish names, prices and photos”." }, { status: 400 });
  const out = await draftSectionType(r.admin.userId, typeof body.name === "string" ? body.name.trim().slice(0, 60) : "", description);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ draft: { fields: out.value.fields, html: out.value.html, defaults: out.value.defaults } });
}
