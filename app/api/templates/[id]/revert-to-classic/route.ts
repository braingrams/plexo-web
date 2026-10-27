import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { isValidUuid } from "@/server/slugDynamo";
import { onTemplateSaved } from "@/lib/siteLayoutDynamo";
import { Template, TemplateRevision } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";
import { designFormatOf } from "@/lib/v2/design";

/**
 * POST /api/templates/:id/revert-to-classic
 *
 * "Go back to the classic editor" for a page that was moved with .../convert-to-v2. Restores the
 * classic design snapshotted at that moment (live content AND the unpublished working copy it had)
 * and sets designFormat back to "v1". Anything done in the new editor since is lost, which the
 * dashboard says before asking. Same auth/permission/scope checks as the other template routes.
 *
 * 200 -> { template: { id, updatedAt }, designFormat: "v1" }
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  if (designFormatOf(existing) !== "v2" || !existing.classicBackupId) {
    return NextResponse.json({ error: "There's no classic version of this page to go back to." }, { status: 409 });
  }

  const { data: revisions } = await TemplateRevision.query.primary({ templateId: existing.id }).go({ order: "desc" });
  const backup = revisions.find((r) => r.id === existing.classicBackupId);
  if (!backup) {
    return NextResponse.json({ error: "The classic version of this page is no longer saved, so it can't be restored." }, { status: 404 });
  }

  const patch = Template.patch({ id: existing.id }).set({
    designFormat: "v1",
    designJson: backup.designJson,
    compiledHtml: backup.compiledHtml,
    ...(backup.draftJson != null ? { draftJson: backup.draftJson, draftHtml: backup.draftHtml ?? backup.compiledHtml } : {}),
  });
  await (backup.draftJson != null ? patch.remove(["classicBackupId"]) : patch.remove(["classicBackupId", "draftJson", "draftHtml"])).go();
  await onTemplateSaved(existing.id);

  const { data: updated } = await Template.get({ id: existing.id }).go();
  return NextResponse.json({ template: { id: existing.id, updatedAt: updated?.updatedAt }, designFormat: "v1" });
}
