import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { SSR_MAX_ZIP_BYTES } from "@/lib/projects/ssrSource";
import { getTierFeatures } from "@/lib/subscription";
import { getObject, deleteObject } from "@/lib/projects/blobStore";
import { isSsrUploadKey } from "@/lib/projects/ssrUpload";
import { assertOrgInstallation } from "@/lib/projects/github/install";
import { downloadRepoZip } from "@/lib/projects/github/archive";
import { GitHubError, gh } from "@/lib/projects/github/client";
import { gitLinkFor, linkSsrRepo, unlinkSsrRepo, type GitSource } from "@/lib/projects/github/ssrPush";
import { DeployedApp } from "@/lib/db/appEntities";
import { queueSsrBuildFromZip } from "@/lib/projects/ssrBuildQueue";
import { isValidGitRef, isValidRepoFullName } from "@/lib/projects/github/validate";

/**
 * POST /api/v1/templates/:id/ssr-deploy
 *
 * Queues an SSR build from a server-rendered app's source zip (package.json at the root, or inside
 * a single wrapper folder). The framework is detected from package.json, the zip is stored, and an
 * SSR build is queued. The build produces the per-customer Lambda `plexo-ssr-<templateId>`.
 *
 * The zip comes in one of two ways:
 *   - JSON { uploadKey }: the zip was sent in parts through ssr-upload/chunk, which assembled it in
 *     the project bucket. This is what the dashboard uses. The assembled object is deleted after.
 *   - multipart/form-data with a `file` field: for small zips (about 4.5 MB at most, Lambda's limit).
 *
 * Responds 202 with the build to poll; the function isn't live until that build succeeds.
 */

// Lambda function names must be 64 characters or fewer and use [A-Za-z0-9_-]. The prefix uses 10.
const TEMPLATE_ID_PATTERN = /^[A-Za-z0-9_-]{1,50}$/;

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;
type Source = { zip: Uint8Array; stagedKey?: string; github?: GitSource } | { error: string; status: number };

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 });
  }

  const { id: templateId } = await context.params;
  if (!TEMPLATE_ID_PATTERN.test(templateId)) {
    return NextResponse.json({ error: "That template id can't be used as a server function name." }, { status: 400 });
  }
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: `No template found with id "${templateId}" for this account.` }, { status: 404 });
  }
  const plan = getTierFeatures(resolved.subscriptionPlan);
  if (!plan.ssrEnabled) {
    return NextResponse.json({ error: "Server-rendered apps are available on the ULTRA plan." }, { status: 403 });
  }

  const source = await readSource(request, templateId, resolved.organizationId);
  if ("error" in source) return NextResponse.json({ error: source.error }, { status: source.status });
  try {
    return await queueBuild(resolved, templateId, plan.ssrMonthlyBudgetUsd, source);
  } finally {
    // The staged upload is only needed until it's read; the build keeps its own copy (ssr/latest.zip).
    if (source.stagedKey) await deleteObject(source.stagedKey).catch(() => undefined);
  }
}

async function readSource(request: NextRequest, templateId: string, organizationId: string): Promise<Source> {
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const body = await request.json().catch(() => null);
    if (body?.github !== undefined) return readGithubSource(body.github, templateId, organizationId);
    const uploadKey = typeof body?.uploadKey === "string" ? body.uploadKey : "";
    if (!isSsrUploadKey(templateId, uploadKey)) {
      return { error: "That upload isn't valid for this app. Start the upload again.", status: 400 };
    }
    const staged = await getObject(uploadKey);
    if (!staged) return { error: "The upload didn't reach storage. Try again.", status: 400 };
    if (staged.body.byteLength > SSR_MAX_ZIP_BYTES) {
      await deleteObject(uploadKey).catch(() => undefined);
      return { error: `Zip exceeds the ${SSR_MAX_ZIP_BYTES / 1024 / 1024}MB limit.`, status: 400 };
    }
    return { zip: new Uint8Array(staged.body), stagedKey: uploadKey };
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { error: "Expected multipart/form-data with a 'file' field, or JSON with an uploadKey.", status: 400 };
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: "No file uploaded. POST a multipart form with a 'file' field containing a .zip of the app's source.", status: 400 };
  }
  if (!file.name.toLowerCase().endsWith(".zip")) {
    return { error: "Only .zip files are accepted. Zip the project folder that contains package.json.", status: 400 };
  }
  if (file.size > SSR_MAX_ZIP_BYTES) {
    return { error: `Zip exceeds the ${SSR_MAX_ZIP_BYTES / 1024 / 1024}MB limit.`, status: 400 };
  }
  return { zip: new Uint8Array(await file.arrayBuffer()) };
}

/** A repo the account connected to Plexo's GitHub app: its branch is downloaded as a zip and built
 * exactly like an uploaded one. The branch is pinned to the commit it points at now, so the build and
 * the app's GitHub link record the same commit. The installation must belong to this organization. */
async function readGithubSource(input: unknown, templateId: string, organizationId: string): Promise<Source> {
  const g = (input ?? {}) as { installationId?: unknown; repo?: unknown; ref?: unknown };
  const installationId = Number(g.installationId);
  const repo = typeof g.repo === "string" ? g.repo.trim() : "";
  const ref = typeof g.ref === "string" && g.ref.trim() ? g.ref.trim() : null;
  if (!installationId || !isValidRepoFullName(repo) || (ref !== null && !isValidGitRef(ref))) {
    return { error: "Pick a GitHub repository and branch from the list.", status: 400 };
  }
  try {
    await assertOrgInstallation(organizationId, installationId);
    const info = await gh<{ id: number; full_name: string; default_branch: string }>(installationId, `/repos/${repo}`);
    const branch = ref ?? info.default_branch;
    const head = await gh<{ object: { sha: string } } | null>(installationId, `/repos/${info.full_name}/git/ref/heads/${encodeURIComponent(branch)}`, { allow404: true });
    if (!head) return { error: "Couldn't find that branch on GitHub, or the repository is empty. Check the branch, then try again.", status: 404 };
    const sha = head.object.sha;
    // A server app is locked to the repository it was first connected to. Any other repo is refused.
    const { data: app } = await DeployedApp.get({ templateId }).go({ attributes: ["gitRepo"] });
    const locked = app?.gitRepo ?? (await gitLinkFor(templateId))?.repoFullName ?? null;
    if (locked && locked.toLowerCase() !== info.full_name.toLowerCase()) {
      return { error: `This app is locked to ${locked}. Connect that repository to build it.`, status: 409 };
    }
    return {
      zip: await downloadRepoZip(installationId, info.full_name, sha),
      github: { installationId, repoFullName: info.full_name.toLowerCase(), repoId: info.id, branch, sha },
    };
  } catch (err) {
    if (err instanceof GitHubError) return { error: err.message, status: err.status >= 400 && err.status < 500 ? err.status : 502 };
    throw err;
  }
}

async function queueBuild(
  resolved: ResolvedUser,
  templateId: string,
  budgetUsd: number,
  source: { zip: Uint8Array; github?: GitSource },
): Promise<NextResponse> {
  // A repo's link is recorded before the build is queued, so the build can write its status to it.
  if (source.github) await linkSsrRepo(templateId, resolved.organizationId, resolved.userId, source.github);
  let outcome;
  try {
    outcome = await queueSsrBuildFromZip({
      organizationId: resolved.organizationId,
      templateId,
      requestedBy: resolved.userId,
      budgetUsd,
      sourceZip: source.zip,
      sourceCommitSha: source.github?.sha,
      gitRepo: source.github?.repoFullName,
    });
  } catch (err) {
    if (source.github) await unlinkSsrRepo(templateId);
    throw err;
  }
  if (!outcome.ok) {
    if (source.github) await unlinkSsrRepo(templateId);
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }
  return NextResponse.json(
    {
      buildId: outcome.buildId,
      status: outcome.status,
      framework: outcome.framework,
      functionName: outcome.functionName,
      warnings: outcome.warnings,
      message: "Source received. The server build is queued; the app goes live when it succeeds.",
    },
    { status: 202 },
  );
}
