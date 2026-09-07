import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { deleteTemplateVersion } from "@/lib/templateVersions";
import { Template, TemplateRevision } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";

/**
 * DELETE /api/templates/:id/revisions/:revisionId
 *
 * Deletes one published version from history. The currently-active/live version
 * (Template.activeVersionId) is never deletable — deleteTemplateVersion
 * (lib/templateVersions.ts) enforces that and this route surfaces it as 400, not 500.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; revisionId: string }> },
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

  const { data: revisions } = await TemplateRevision.query
    .primary({ templateId: existing.id })
    .go({ order: "desc" });
  const revision = revisions.find((r) => r.id === params.revisionId);
  if (!revision) {
    return NextResponse.json(
      { error: "That version could no longer be found." },
      { status: 404 },
    );
  }

  try {
    await deleteTemplateVersion(
      existing.id,
      existing.activeVersionId,
      revision.id,
      revision.createdAt,
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Couldn't delete this version.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
