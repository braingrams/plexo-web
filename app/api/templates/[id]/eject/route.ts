import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { isValidUuid } from "@/server/slugDynamo";
import { Template } from "@/lib/db/contentEntities";

/**
 * POST /api/templates/:id/eject
 *
 * Switches a BUILDER page to RAW_UPLOAD in place — a non-destructive flag flip, not a
 * re-upload: compiledHtml already holds this page's fully compiled output, so there's
 * nothing to regenerate. From this point on the page is edited as text (via the raw-file
 * editor) instead of the visual builder; designJson is left untouched but ignored going
 * forward (BUILDER-mode edits would no longer reach the served page).
 *
 * `sourceType` isn't part of Template's primary key composite (contentEntities.ts: pk is
 * just `id`), so this is a plain in-place `.patch().set()`.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = requirePermission(resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  const { data: existing } = await Template.get({ id }).go();
  if (!existing || existing.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }
  if (existing.sourceType === "RAW_UPLOAD") {
    return NextResponse.json({ error: "This page is already raw HTML." }, { status: 400 });
  }

  await Template.patch({ id: existing.id }).set({ sourceType: "RAW_UPLOAD" }).go();
  const { data: updated } = await Template.get({ id: existing.id }).go();
  if (!updated) throw new Error(`Template ${existing.id} vanished immediately after being updated`);

  return NextResponse.json({ page: { id: updated.id, sourceType: updated.sourceType } });
}
