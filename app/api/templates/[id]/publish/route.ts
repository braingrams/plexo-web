import { NextRequest, NextResponse } from "next/server";

import { sanitizeHtml } from "@/server/sanitizer";
import { compileToHTML } from "@/lib/compiler";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { compileWithSiteLayout, onTemplateSaved } from "@/lib/siteLayoutDynamo";
import { publishTemplateDraft } from "@/lib/templateVersions";
import { Template } from "@/lib/db/contentEntities";
import { Member, User } from "@/lib/db/coreEntities";

/**
 * POST /api/templates/:id/publish
 *
 * Snapshots the template's current working draft (draftJson/draftHtml — or, if nothing's
 * been drafted since the last publish, its current live content) into a new immutable
 * TemplateRevision, then flips it live. This is the ONLY route that ever makes an edit
 * live — see lib/templateVersions.ts's publishTemplateDraft for the atomic
 * create-revision + patch-template transaction, and app/api/templates/update/:id for the
 * autosave route that only ever touches the draft.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = requirePermission(resolved.role, {
    template: ["update"],
  });
  if (permissionError) return permissionError;

  const params = await context.params;

  const { data: existing } = await Template.get({ id: params.id }).go();
  if (!existing || existing.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  if (resolved.role !== null) {
    const { data: member } = await Member.get({
      organizationId: resolved.organizationId,
      userId: resolved.userId,
    }).go();
    const scopeError = requireTemplateScope(member, existing.id);
    if (scopeError) return scopeError;
  }

  const designJson = existing.draftJson ?? existing.designJson;

  // Same "never trust a client-supplied compile" rule as the update route this draft came
  // from — recompute compiledHtml server-side (with site-layout header/footer applied),
  // rather than trusting draftHtml, since draftHtml was compiled without that awareness.
  let compiledHtml = existing.draftHtml ?? existing.compiledHtml;
  if (existing.kind === "LANDING_PAGE") {
    const forCompile = await compileWithSiteLayout(
      { id: existing.id, parentId: existing.parentId ?? null },
      designJson,
    );
    compiledHtml = sanitizeHtml(compileToHTML(forCompile));
  }

  const { data: user } = await User.get({ id: resolved.userId }).go();

  const { revisionId } = await publishTemplateDraft(
    existing,
    { userId: resolved.userId, userName: user?.name ?? "Plexo User" },
    designJson,
    compiledHtml,
  );

  await onTemplateSaved(existing.id);

  return NextResponse.json({
    template: { id: existing.id },
    version: { id: revisionId },
  });
}
