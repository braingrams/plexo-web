import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { onTemplateSaved } from "@/lib/siteLayoutDynamo";
import { restoreTemplateVersion } from "@/lib/templateVersions";
import { Template, TemplateRevision } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";

/**
 * POST /api/templates/:id/restore/:revisionId
 *
 * Makes a prior published version the active live site again — the "restore any
 * historical version" acceptance criterion. Versions are immutable rows already
 * (lib/db/contentEntities.ts's TemplateRevision), so restoring never manufactures a new
 * one: it just moves Template.activeVersionId back to an existing version and copies its
 * content into the live designJson/compiledHtml fields (lib/templateVersions.ts's
 * restoreTemplateVersion), discarding any not-yet-published draft in the process.
 *
 * revisionId is TemplateRevision's own `id` attribute, not its full templateId/sk
 * composite key (sk is "createdAt#id" — see lib/db/contentEntities.ts). Resolving it means
 * querying the template's revision history and matching on id, rather than composing the
 * "createdAt#id" sort key into the URL: `id` alone is exactly what
 * GET /api/templates/:id/revisions already hands the frontend to round-trip back here, and
 * TemplateRevision is capped at 20 rows/template (lib/templateVersions.ts), so the query
 * is always cheap — no need for a second, key-composing route-param shape.
 */
export async function POST(
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
      {
        error:
          "That version could no longer be found — it may have aged out of history.",
      },
      { status: 404 },
    );
  }

  await restoreTemplateVersion(existing.id, revision);
  const { data: updated } = await Template.get({ id: existing.id }).go();
  if (!updated)
    throw new Error(
      `Template ${existing.id} vanished immediately after being restored`,
    );

  await onTemplateSaved(existing.id);

  return NextResponse.json({
    template: {
      id: updated.id,
      updatedAt: updated.updatedAt,
    },
  });
}
