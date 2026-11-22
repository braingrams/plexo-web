import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { isValidUuid } from "@/server/slugDynamo";
import { Template } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";
import type { ConvertSource } from "@/lib/editorModes/convertPage";
import { convertToCode, previewConvert } from "@/lib/editorModes/convertService";

/**
 * POST /api/templates/:id/convert-to-code    body: { "source"?: "working" | "live", "preview"?: true }
 *
 * Turns ONE block-built page into editable code (a page of your own HTML), so it gets the Design | Code | Text views.
 *  - `preview: true` changes nothing: it returns the code the page would become, and what to tell the owner first.
 *  - Otherwise: (1) the page's blocks (live design AND the unpublished working copy) are saved as a restorable backup,
 *    (2) the blocks are rendered with the real build, so the code is exactly the page visitors get, and checked to be
 *    the same page, (3) the page switches to code. Nothing is written if any step fails.
 * Pages made of code have no separate draft, so if the owner has unpublished changes they choose which version to keep:
 * "working" (their latest, which then goes live as code) or "live" (what visitors see; their working copy stays in the backup).
 * The server always renders from what is stored, never from a design sent by the browser. Same auth/permission/scope
 * checks as the other page routes. POST /api/templates/:id/restore-blocks goes back.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const permissionError = requirePermission(resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Page not found." }, { status: 404 });

  if (resolved.role !== null) {
    const { data: member } = await Member.get({ organizationId: resolved.organizationId, userId: resolved.userId }).go();
    const scopeError = requireTemplateScope(member, id);
    if (scopeError) return scopeError;
  }

  const { data: existing } = await Template.get({ id }).go();
  if (!existing || existing.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { source?: unknown; preview?: unknown };
  const source: ConvertSource = body.source === "live" ? "live" : "working";

  if (body.preview === true) {
    const preview = await previewConvert(existing, source);
    if (!preview.ok) return NextResponse.json({ error: preview.error }, { status: preview.status });
    return NextResponse.json(preview.value);
  }

  const done = await convertToCode(existing, source, { userId: resolved.userId });
  if (!done.ok) return NextResponse.json({ error: done.error }, { status: done.status });
  return NextResponse.json({ template: { id: existing.id }, sourceType: "RAW_UPLOAD", usedWorkingCopy: done.value.usedWorkingCopy });
}
