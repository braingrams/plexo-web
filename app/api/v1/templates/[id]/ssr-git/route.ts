import { planGateBody } from "@/lib/plan/planGate";
import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { getTierFeatures } from "@/lib/subscription";
import { gitLinkFor } from "@/lib/projects/github/ssrPush";
import { isFinished, recentBuilds } from "@/lib/projects/builds";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/templates/:id/ssr-git
 *   The GitHub connection of a server app, and how its last push went:
 *   { linked: false, activeBuildId } or { linked, repo, branch, commitSha, status, statusMessage, publishOnPush, activeBuildId }.
 *   activeBuildId is the server build that is queued or running now (null when none), so the panel can show its log.
 *   status is "ERROR" when the latest push wasn't built or published (statusMessage says why).
 *
 * Pro plan and above, like the rest of the server app routes.
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
    return NextResponse.json(planGateBody("PLAN_SERVER_APPS", "Server apps are part of the Pro plan. Upgrade to use them."), { status: 403 });
  }
  // The server build that is queued or running right now, if any. The dashboard attaches to it to show the log.
  const activeBuild = (await recentBuilds(templateId, 5)).find((b) => b.kind === "ssr" && !isFinished(b)) ?? null;
  const link = await gitLinkFor(templateId);
  if (!link) return NextResponse.json({ linked: false, activeBuildId: activeBuild?.id ?? null });
  return NextResponse.json({
    linked: true,
    repo: link.repoFullName,
    branch: link.branch,
    commitSha: link.lastSyncedCommitSha ?? null,
    status: link.status,
    statusMessage: link.statusMessage ?? "",
    publishOnPush: link.publishOnPush !== false,
    activeBuildId: activeBuild?.id ?? null,
  });
}
