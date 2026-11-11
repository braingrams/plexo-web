import { NextRequest, NextResponse } from "next/server";
import { requireUser, appError } from "@/lib/projects/appAccess";
import { gh, GitHubError } from "@/lib/projects/github/client";
import { assertOrgInstallation } from "@/lib/projects/github/install";

/**
 * GET /api/v1/github/repos?installationId=<id>
 *   → { repos: [{ id, fullName, defaultBranch, private }] }
 *
 * The repositories one connected GitHub account or organization gave Plexo access to. Only
 * installations that belong to the caller's organization are listed.
 */
const MAX_PAGES = 3;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await requireUser(request);
  if (resolved instanceof NextResponse) return resolved;
  const installationId = Number(request.nextUrl.searchParams.get("installationId"));
  if (!installationId) return NextResponse.json({ error: "Pick a GitHub account first." }, { status: 400 });
  try {
    await assertOrgInstallation(resolved.organizationId, installationId);
    const repos: Array<{ id: number; fullName: string; defaultBranch: string; private: boolean }> = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await gh<{ repositories: Array<{ id: number; full_name: string; default_branch: string; private: boolean }> }>(installationId, `/installation/repositories?per_page=100&page=${page}`);
      repos.push(...res.repositories.map((r) => ({ id: r.id, fullName: r.full_name, defaultBranch: r.default_branch || "main", private: r.private })));
      if (res.repositories.length < 100) break;
    }
    return NextResponse.json({ repos });
  } catch (err) {
    if (err instanceof GitHubError) return NextResponse.json({ error: err.message }, { status: err.status >= 500 ? 502 : err.status });
    return appError(err);
  }
}
