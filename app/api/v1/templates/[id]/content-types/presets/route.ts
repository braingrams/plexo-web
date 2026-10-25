import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { resolveCustomContentAdmin } from "@/lib/customContent/adminAuthDynamo";
import { CONTENT_PRESETS, ensureContentPreset, isContentPresetId } from "@/lib/customContent/presets";
import { Member } from "@/lib/db/coreEntities";

/** GET → the ready-made content types an owner can add in one click. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    presets: Object.entries(CONTENT_PRESETS).map(([id, p]) => ({ id, name: p.name, slug: p.slug, blurb: p.blurb })),
  });
}

/** POST { preset: "videos" | "stories" | "events" } → adds it to the site (no-op if already there). */
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
  if (!isContentPresetId(body.preset)) {
    return NextResponse.json({ error: `Choose one of: ${Object.keys(CONTENT_PRESETS).join(", ")}.` }, { status: 400 });
  }
  const { contentType, created } = await ensureContentPreset({ templateId, organizationId, preset: body.preset });
  return NextResponse.json({ contentType, created }, { status: created ? 201 : 200 });
}
