import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { getTierFeatures } from "@/lib/subscription";
import { gitLinkFor } from "@/lib/projects/github/ssrPush";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/templates/:id/ssr-git
 *   The GitHub connection of a server app, and how its last push went:
 *   { linked: false } or { linked, repo, branch, commitSha, status, statusMessage, publishOnPush }.
 *   status is "ERROR" when the latest push wasn't built or published (statusMessage says why).
 *
 * ULTRA plan only, like the rest of the server app routes.
 */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 });
  const { id: templateId } = await params;
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: `No template found with id "${templateId}" for this account.` }, { status: 404 });
  }
  if (!getTierFeatures(resolved.subscriptionPlan).ssrEnabled) {
    return NextResponse.json({ error: "Server-rendered apps are available on the ULTRA plan." }, { status: 403 });
  }
  const link = await gitLinkFor(templateId);
  if (!link) return NextResponse.json({ linked: false });
  return NextResponse.json({
    linked: true,
    repo: link.repoFullName,
    branch: link.branch,
    commitSha: link.lastSyncedCommitSha ?? null,
    status: link.status,
    statusMessage: link.statusMessage ?? "",
    publishOnPush: link.publishOnPush !== false,
  });
}
