import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { Template, TemplateRevision } from "@/lib/db/contentEntities";

/**
 * GET /api/templates/:id/revisions
 *
 * Lists a template's published version history for the dashboard's Version History
 * panel — id, createdAt, author, and whether it's the currently-active/live version, not
 * the full designJson/compiledHtml blobs, to keep the response small. A restore round-trips
 * the `id` back through POST /api/templates/:id/restore/:revisionId, which fetches the
 * full content itself.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const { data: template } = await Template.get({ id }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const { data: revisions } = await TemplateRevision.query
    .primary({ templateId: id })
    .go({ order: "desc" });

  return NextResponse.json({
    revisions: revisions.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      authorName: r.authorName ?? "Unknown",
      isActive: r.id === template.activeVersionId,
    })),
    hasUnpublishedChanges: template.draftJson != null,
  });
}
