import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { isValidUuid } from "@/server/slugDynamo";
import { Template } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";
import { restoreBlocks } from "@/lib/editorModes/convertService";

/**
 * POST /api/templates/:id/restore-blocks
 *
 * "Go back to blocks" for a page that was turned into code with .../convert-to-code. Restores the block design saved at that
 * moment (live content AND the unpublished working copy it had) and makes the page a block page again. Changes made to the
 * code since are not kept, which the dashboard says before asking. The live page is rebuilt with the site's CURRENT header and
 * footer, so it doesn't come back with an old copy of them.
 *
 * 200 -> { template: { id }, sourceType: "BUILDER" }
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
  const done = await restoreBlocks(existing);
  if (!done.ok) return NextResponse.json({ error: done.error }, { status: done.status });
  return NextResponse.json({ template: { id: existing.id }, sourceType: "BUILDER" });
}
