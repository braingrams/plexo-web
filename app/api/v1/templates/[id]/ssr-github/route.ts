import { planGateBody } from "@/lib/plan/planGate";
import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { Template } from "@/lib/db/contentEntities";
import { getTierFeatures } from "@/lib/subscription";
import { githubConfigured, installUrl, gh, GitHubError } from "@/lib/projects/github/client";
import { signInstallState, orgInstallations, assertOrgInstallation } from "@/lib/projects/github/install";
import { isSafeReturnPath } from "@/lib/projects/github/validate";
import { gitLinkFor, unlinkSsrRepo } from "@/lib/projects/github/ssrPush";
import { DeployedApp } from "@/lib/db/appEntities";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The GitHub connection of a server app (the detail page's GitHub section).
 *
 * GET ?installationId=&returnTo=  → { configured, link, installations, installUrl, repos? }
 *   repos is listed for the chosen account. returnTo brings the install back to the detail page.
 * DELETE                          → disconnects the repo. Pushes stop building the app; its files stay.
 *
 * Connecting, and changing the branch, go through POST /api/v1/templates/:id/ssr-deploy with a github source.
 * Pro plan and above, like the other server app routes.
 */
async function ownedServerApp(request: NextRequest, templateId: string) {
  const resolved = await resolveUser(request);
  if (!resolved) return { error: NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 }) };
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return { error: NextResponse.json({ error: `No template found with id "${templateId}" for this account.` }, { status: 404 }) };
  }
  if (!getTierFeatures(resolved.subscriptionPlan).ssrEnabled) {
    return { error: NextResponse.json(planGateBody("PLAN_SERVER_APPS", "Server apps are part of the Pro plan. Upgrade to use them."), { status: 403 }) };
  }
  return { resolved };
}

export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id: templateId } = await params;
  const check = await ownedServerApp(request, templateId);
  if (check.error) return check.error;
  const { resolved } = check;
  if (!githubConfigured()) return NextResponse.json({ configured: false });
  try {
    const [link, installations, { data: app }] = await Promise.all([
      gitLinkFor(templateId),
      orgInstallations(resolved.organizationId),
      DeployedApp.get({ templateId }).go({ attributes: ["gitRepo"] }),
    ]);
    // The repository this app is locked to. Once set, the app only connects to that repository.
    const lockedRepo = app?.gitRepo ?? link?.repoFullName ?? null;
    const installationId = Number(request.nextUrl.searchParams.get("installationId")) || null;
    let repos: Array<{ id: number; fullName: string; defaultBranch: string; private: boolean; empty: boolean }> | undefined;
    if (installationId) {
      await assertOrgInstallation(resolved.organizationId, installationId);
      repos = [];
      for (let page = 1; page <= 3; page++) {
        const res = await gh<{ repositories: Array<{ id: number; full_name: string; default_branch: string; private: boolean; size: number }> }>(
          installationId,
          `/installation/repositories?per_page=100&page=${page}`,
        );
        repos.push(...res.repositories.map((r) => ({ id: r.id, fullName: r.full_name, defaultBranch: r.default_branch || "main", private: r.private, empty: r.size === 0 })));
        if (res.repositories.length < 100) break;
      }
    }
    const returnTo = request.nextUrl.searchParams.get("returnTo");
    return NextResponse.json({
      configured: true,
      lockedRepo,
      link: link
        ? { installationId: link.installationId, repo: link.repoFullName, branch: link.branch, status: link.status, statusMessage: link.statusMessage ?? null }
        : null,
      installations: installations.map((i) => ({ id: i.installationId, account: i.accountLogin, type: i.accountType ?? null })),
      installUrl: installUrl(
        signInstallState({
          appId: templateId,
          organizationId: resolved.organizationId,
          userId: resolved.userId,
          returnTo: isSafeReturnPath(returnTo) ? returnTo : null,
        }),
      ),
      repos,
    });
  } catch (err) {
    if (err instanceof GitHubError) return NextResponse.json({ error: err.message }, { status: err.status >= 500 ? 502 : err.status });
    throw err;
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id: templateId } = await params;
  const check = await ownedServerApp(request, templateId);
  if (check.error) return check.error;
  const denied = requirePermission(check.resolved.role, { template: ["update"] });
  if (denied) return denied;
  await unlinkSsrRepo(templateId);
  return NextResponse.json({ unlinked: true });
}
