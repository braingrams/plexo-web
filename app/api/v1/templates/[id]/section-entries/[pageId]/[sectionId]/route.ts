import { NextRequest, NextResponse } from "next/server";
import { resolveSectionAdmin } from "@/lib/customSections/auth";
import { getEntry, updateEntry } from "@/lib/customSections/entries";
import { PageToolError } from "@/lib/mcp/v2Pages";

type Ctx = { params: Promise<{ id: string; pageId: string; sectionId: string }> };

const fail = (err: unknown): NextResponse => {
  if (err instanceof PageToolError) return NextResponse.json({ error: err.message }, { status: 400 });
  console.error("[custom-sections] entry request failed", err);
  return NextResponse.json({ error: "We couldn't do that just now. Please try again." }, { status: 500 });
};

/** GET — one use of a section: the fields to fill in and what's in them now (the page's working copy when it has one). */
export async function GET(request: NextRequest, context: Ctx): Promise<NextResponse> {
  const { id, pageId, sectionId } = await context.params;
  const r = await resolveSectionAdmin(request, id, false);
  if ("error" in r) return r.error;
  try {
    const e = await getEntry(r.admin.siteId, r.admin.organizationId, pageId, sectionId);
    return NextResponse.json({ entry: { pageId, pageTitle: e.pageTitle, sectionId, typeId: e.type.id, typeName: e.type.name, fields: e.type.fields, content: e.content, draft: e.draft } });
  } catch (err) {
    return fail(err);
  }
}

/** PUT { content } — saves the words for one use. It goes live straight away; the page's own unpublished changes stay as they were. */
export async function PUT(request: NextRequest, context: Ctx): Promise<NextResponse> {
  const { id, pageId, sectionId } = await context.params;
  const r = await resolveSectionAdmin(request, id, true);
  if ("error" in r) return r.error;
  const body = (await request.json().catch(() => ({}))) as { content?: unknown };
  if (!body.content || typeof body.content !== "object" || Array.isArray(body.content)) return NextResponse.json({ error: "Send the new words as { content: { … } }." }, { status: 400 });
  try {
    const out = await updateEntry(r.admin.siteId, r.admin.organizationId, pageId, sectionId, body.content as Record<string, unknown>);
    return NextResponse.json({ ok: true, ...out });
  } catch (err) {
    return fail(err);
  }
}
