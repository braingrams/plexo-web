import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { isValidUuid } from "@/server/slugDynamo";
import { Template } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";
import { shouldWriteReviewFlag } from "@/lib/dashboardV3/startReview";

/**
 * POST /api/templates/:id/start-review
 *
 * The owner opened the editor from the hub's "Your website is ready" steps, so "Review and edit your pages" is done for this
 * site: remembered on the site itself (startReviewedAt), so the hub panel and Home's checklist agree on every device.
 * Only someone who can edit the site may set it, and setting it again changes nothing.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const permissionError = requirePermission(resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "We couldn't find that website." }, { status: 404 });

  if (resolved.role !== null) {
    const { data: member } = await Member.get({ organizationId: resolved.organizationId, userId: resolved.userId }).go();
    const scopeError = requireTemplateScope(member, id);
    if (scopeError) return scopeError;
  }

  const { data: site } = await Template.get({ id }).go({ attributes: ["id", "organizationId", "createdAt", "updatedAt", "startReviewedAt"] });
  if (!site || site.organizationId !== resolved.organizationId) return NextResponse.json({ error: "We couldn't find that website." }, { status: 404 });

  if (shouldWriteReviewFlag(site)) {
    await Template.patch({ id }).set({ startReviewedAt: new Date().toISOString() }).go();
  }
  return NextResponse.json({ ok: true });
}
