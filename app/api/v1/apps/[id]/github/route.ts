import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError, readBody } from "@/lib/projects/appAccess";
import { githubConfigured, installUrl, gh, GitHubError } from "@/lib/projects/github/client";
import { signInstallState, orgInstallations, assertOrgInstallation } from "@/lib/projects/github/install";
import { getLink, linkRepo, unlinkRepo, pushVersion } from "@/lib/projects/github/sync";
import { startPreview } from "@/lib/projects/pipeline";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The app's GitHub connection.
 *   GET [?installationId=] → { configured, link, installations, installUrl, repos? }
 *   POST { installationId, repo: "owner/name", branch, prefer?: "plexo" | "github" } → link
 *        (an empty repo gets the app; a repo with code is imported unless prefer: "plexo")
 *   PATCH { action: "sync" } → push the latest version now (after fixing a conflict/error)
 *   DELETE → unlink (the repository itself is untouched)
 */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  if (!githubConfigured()) return NextResponse.json({ configured: false });
  try {
    const [link, installations] = await Promise.all([getLink(id), orgInstallations(loaded.resolved.organizationId)]);
    const installationId = Number(request.nextUrl.searchParams.get("installationId")) || null;
    let repos: Array<{ id: number; fullName: string; defaultBranch: string; private: boolean; empty: boolean }> | undefined;
    if (installationId) {
      await assertOrgInstallation(loaded.resolved.organizationId, installationId);
      repos = [];
      for (let page = 1; page <= 3; page++) {
        const res = await gh<{ repositories: Array<{ id: number; full_name: string; default_branch: string; private: boolean; size: number }> }>(installationId, `/installation/repositories?per_page=100&page=${page}`);
        repos.push(...res.repositories.map((r) => ({ id: r.id, fullName: r.full_name, defaultBranch: r.default_branch || "main", private: r.private, empty: r.size === 0 })));
        if (res.repositories.length < 100) break;
      }
    }
    return NextResponse.json({
      configured: true,
      link: link
        ? { repo: link.repoFullName, branch: link.branch, status: link.status, statusMessage: link.statusMessage ?? null, conflictPullRequestUrl: link.conflictPullRequestUrl ?? null, lastSyncedCommitSha: link.lastSyncedCommitSha ?? null, lastSyncedAt: link.lastSyncedAt ?? null }
        : null,
      installations: installations.map((i) => ({ id: i.installationId, account: i.accountLogin, type: i.accountType ?? null })),
      installUrl: installUrl(signInstallState({ appId: id, organizationId: loaded.resolved.organizationId, userId: loaded.resolved.userId })),
      repos,
    });
  } catch (err) {
    if (err instanceof GitHubError) return NextResponse.json({ error: err.message }, { status: err.status >= 500 ? 502 : err.status });
    return appError(err);
  }
}

export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  try {
    const body = await readBody(request);
    const installationId = Number(body.installationId);
    const repo = typeof body.repo === "string" ? body.repo.trim() : "";
    const branch = typeof body.branch === "string" && /^[\w./-]{1,200}$/.test(body.branch) ? body.branch : "main";
    if (!installationId || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return NextResponse.json({ error: "Pick a repository." }, { status: 400 });
    await assertOrgInstallation(loaded.resolved.organizationId, installationId);
    const info = await gh<{ id: number; full_name: string }>(installationId, `/repos/${repo}`);
    const result = await linkRepo({
      templateId: id,
      organizationId: loaded.resolved.organizationId,
      installationId,
      repoFullName: info.full_name,
      repoId: info.id,
      branch,
      linkedBy: loaded.resolved.userId,
      prefer: body.prefer === "plexo" ? "plexo" : "github",
    });
    const build = result.action === "imported" ? await startPreview(id, loaded.actor, { message: `Imported from ${info.full_name}`, source: "git" }).catch(() => null) : null;
    return NextResponse.json({ ...result, buildId: build?.id ?? null });
  } catch (err) {
    if (err instanceof GitHubError) return NextResponse.json({ error: err.message }, { status: err.status >= 500 ? 502 : err.status });
    return appError(err);
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  if (!loaded.app.headVersionId) return NextResponse.json({ error: "Nothing to push yet." }, { status: 409 });
  const result = await pushVersion(id, loaded.app.headVersionId);
  const link = await getLink(id);
  return NextResponse.json({ result, status: link?.status ?? null, statusMessage: link?.statusMessage ?? null });
}

export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  await unlinkRepo(id);
  return NextResponse.json({ unlinked: true });
}
