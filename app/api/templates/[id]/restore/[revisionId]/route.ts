import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { onTemplateSaved } from "@/lib/siteLayoutDynamo";
import { snapshotTemplateRevision } from "@/lib/templateRevisions";
import { Template, TemplateRevision } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";

/**
 * POST /api/templates/:id/restore/:revisionId
 *
 * Rolls a template's designJson/compiledHtml back to a prior TemplateRevision snapshot —
 * the "instant rollbacks" half of app/new/feature-grid.tsx's marketing claim.
 *
 * revisionId is TemplateRevision's own `id` attribute, not its full templateId/sk
 * composite key (sk is "createdAt#id" — see lib/db/contentEntities.ts). Resolving it means
 * querying the template's revision history and matching on id, rather than composing the
 * "createdAt#id" sort key into the URL: `id` alone is exactly what
 * GET /api/templates/:id/revisions already hands the frontend to round-trip back here, and
 * TemplateRevision is capped at 20 rows/template (lib/templateRevisions.ts), so the query
 * is always cheap — no need for a second, key-composing route-param shape.
 *
 * Restoring is itself snapshotted first (same as any other overwrite of a template's
 * content) — a restore is never a destructive dead-end, it's always one more undoable step.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; revisionId: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = requirePermission(resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const params = await context.params;

  const { data: existing } = await Template.get({ id: params.id }).go();
  if (!existing || existing.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  if (resolved.role !== null) {
    const { data: member } = await Member.get({ organizationId: resolved.organizationId, userId: resolved.userId }).go();
    const scopeError = requireTemplateScope(member, existing.id);
    if (scopeError) return scopeError;
  }

  const { data: revisions } = await TemplateRevision.query.primary({ templateId: existing.id }).go({ order: "desc" });
  const revision = revisions.find((r) => r.id === params.revisionId);
  if (!revision) {
    return NextResponse.json({ error: "That version could no longer be found — it may have aged out of history." }, { status: 404 });
  }

  // Snapshot the current (pre-restore) state before overwriting it — same rule every other
  // Template content overwrite follows (see lib/templateRevisions.ts) — so restoring an
  // old version never destroys the one you were just looking at.
  void snapshotTemplateRevision(existing).catch((err) =>
    console.error(`Failed to snapshot revision for template ${existing.id} before restore (non-fatal):`, err),
  );

  await Template.patch({ id: existing.id }).set({ designJson: revision.designJson, compiledHtml: revision.compiledHtml }).go();
  const { data: updated } = await Template.get({ id: existing.id }).go();
  if (!updated) throw new Error(`Template ${existing.id} vanished immediately after being restored`);

  await onTemplateSaved(existing.id);

  return NextResponse.json({
    template: {
      id: updated.id,
      updatedAt: updated.updatedAt,
    },
  });
}
