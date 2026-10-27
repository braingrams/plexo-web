import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { isValidUuid } from "@/server/slugDynamo";
import { Template, TemplateRevision } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";
import { compileTemplateWithSiteLayout } from "@/lib/siteLayoutDynamo";
import { convertV1ToV2 } from "@/lib/v2/convertV1";
import { designFormatOf, V2DesignError } from "@/lib/v2/design";

/**
 * POST /api/templates/:id/convert-to-v2
 *
 * Moves ONE classic page to the new editor, opt-in and reversible. No body.
 *  1. The classic design (live + unpublished working copy) is snapshotted as a TemplateRevision
 *     (Template.classicBackupId points at it) so POST .../revert-to-classic can restore it exactly.
 *  2. The design is converted ON THE SERVER from what is stored (never from a client payload) with
 *     the same function the dashboard preview ran (lib/v2/convertV1.ts).
 *  3. designFormat flips to "v2". Live compiledHtml is NOT touched: the visitor-facing page only
 *     changes when the owner publishes. A working copy (draft) is converted and compiled too.
 * Same auth/permission/scope checks as the autosave route. Emails, uploaded HTML, apps and
 * header/footer/blog/store/funnel layouts stay classic, with a plain message.
 *
 * 200 -> { template: { id, updatedAt }, designFormat: "v2", fidelity, warnings, hasUnpublishedChanges }
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

  if (existing.kind === "EMAIL") {
    return NextResponse.json({ error: "Email templates keep using the classic editor." }, { status: 400 });
  }
  if (existing.sourceType !== "BUILDER") {
    return NextResponse.json({ error: "This page was uploaded as code, so it can't move to the new editor." }, { status: 400 });
  }
  if (existing.isBlogLayout || existing.isSiteLayoutFragment || existing.isCommerceLayout || existing.isLmsPageDesign) {
    return NextResponse.json({ error: "This is a shared layout, which keeps using the classic editor for now." }, { status: 400 });
  }
  if (designFormatOf(existing) === "v2") {
    return NextResponse.json({ error: "This page already uses the new editor." }, { status: 409 });
  }

  const page = { id: existing.id, name: existing.name, slug: existing.slug, isHome: !existing.parentId };
  const live = convertV1ToV2(existing.designJson, page);
  if (!live.ok) return NextResponse.json({ error: live.error }, { status: 400 });
  const draft = existing.draftJson != null ? convertV1ToV2(existing.draftJson, page) : null;
  if (draft && !draft.ok) return NextResponse.json({ error: draft.error }, { status: 400 });
  const shown = draft && draft.ok ? draft : live;

  // Make sure the converted page really builds before anything is written.
  let draftHtml: string | null = null;
  try {
    const asV2 = { id: existing.id, parentId: existing.parentId ?? null, kind: existing.kind, name: existing.name, designFormat: "v2" as const };
    if (draft && draft.ok) draftHtml = await compileTemplateWithSiteLayout(asV2, draft.design);
    else await compileTemplateWithSiteLayout(asV2, live.design);
  } catch (err) {
    const message = err instanceof V2DesignError ? err.message : "This page couldn't be built in the new editor.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const backupId = randomUUID();
  await TemplateRevision.create({
    id: backupId,
    templateId: existing.id,
    designFormat: "v1",
    designJson: existing.designJson,
    compiledHtml: existing.compiledHtml,
    ...(existing.draftJson != null ? { draftJson: existing.draftJson, draftHtml: existing.draftHtml ?? existing.compiledHtml } : {}),
    sdkVersion: "unknown",
    authorId: resolved.userId,
    authorName: "Before moving to the new editor",
    createdAt: new Date().toISOString(),
  }).go();

  const patch = Template.patch({ id: existing.id }).set({
    designFormat: "v2",
    designJson: live.design,
    classicBackupId: backupId,
    ...(draft && draft.ok ? { draftJson: draft.design, draftHtml: draftHtml ?? "" } : {}),
  });
  await (draft ? patch : patch.remove(["draftJson", "draftHtml"])).go();

  const { data: updated } = await Template.get({ id: existing.id }).go();
  return NextResponse.json({
    template: { id: existing.id, updatedAt: updated?.updatedAt },
    designFormat: "v2",
    fidelity: shown.fidelity,
    warnings: shown.warnings,
    hasUnpublishedChanges: draft != null,
  });
}
