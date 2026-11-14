import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { GitHubInstallation, ProjectGitLink } from "@/lib/db/projectEntities";
import { orgInstallations } from "@/lib/projects/github/install";
import { uninstallGitHubApp, GitHubError } from "@/lib/projects/github/client";

/**
 * The GitHub accounts this workspace has connected (Settings → GitHub).
 *
 * GET                          → { installations: [{ id, account, type, linkedApps }] }
 * DELETE ?installationId=N     → revokes the account completely: removes the Plexo App from it on GitHub,
 *                                stops every app that syncs from it, and forgets the connection in Plexo.
 *                                Owners and admins only. Apps keep their current files.
 */
async function linksFor(organizationId: string, installationId: number) {
  const { data } = await ProjectGitLink.scan
    .where((attr, op) => `${op.eq(attr.organizationId, organizationId)} AND ${op.eq(attr.installationId, installationId)}`)
    .go({ pages: "all" });
  return data;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 });
  const installations = await orgInstallations(resolved.organizationId);
  const counts = await Promise.all(installations.map(async (i) => (await linksFor(resolved.organizationId, i.installationId)).length));
  return NextResponse.json({
    installations: installations.map((i, n) => ({ id: i.installationId, account: i.accountLogin, type: i.accountType ?? null, linkedApps: counts[n] })),
  });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 });
  const denied = requirePermission(resolved.role, { organization: ["update"] });
  if (denied) return denied;

  const installationId = Number(request.nextUrl.searchParams.get("installationId"));
  if (!installationId) return NextResponse.json({ error: "Choose a GitHub account to revoke." }, { status: 400 });
  const { data: record } = await GitHubInstallation.get({ organizationId: resolved.organizationId, installationId }).go();
  if (!record) return NextResponse.json({ error: "That GitHub account isn't connected to this workspace." }, { status: 404 });

  // GitHub first: if it refuses, nothing in Plexo has changed yet and the owner can try again.
  try {
    await uninstallGitHubApp(installationId);
  } catch (err) {
    if (err instanceof GitHubError) return NextResponse.json({ error: err.message }, { status: 502 });
    throw err;
  }

  const links = await linksFor(resolved.organizationId, installationId);
  for (const link of links) await ProjectGitLink.delete({ templateId: link.templateId }).go();
  await GitHubInstallation.delete({ organizationId: resolved.organizationId, installationId }).go();
  return NextResponse.json({ revoked: true, unlinkedApps: links.length });
}
