import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { inspectSsrSource, SSR_MAX_ZIP_BYTES } from "@/lib/projects/ssrSource";
import { startSsrBuild, BuildUnavailableError } from "@/lib/projects/builds";
import { getTierFeatures } from "@/lib/subscription";
import { reserveSsrBuild, releaseSsrBuild } from "@/lib/projects/ssrBudget";
import { ssrFunctionName } from "@/lib/appFunctions/ssrNames";
import { listSsrVariables } from "@/lib/appFunctions/ssrVariableStore";
import { buildVariablesFor, buildVarsHash } from "@/lib/appFunctions/ssrVariables";
import { DeployedApp } from "@/lib/db/appEntities";
import { markBuildQueued } from "@/lib/projects/ssrRebuild";
import { getObject, deleteObject } from "@/lib/projects/blobStore";
import { isSsrUploadKey } from "@/lib/projects/ssrUpload";

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
type Source = { zip: Uint8Array; stagedKey?: string } | { error: string; status: number };

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

  const source = await readSource(request, templateId);
  if ("error" in source) return NextResponse.json({ error: source.error }, { status: source.status });
  try {
    return await queueBuild(resolved, templateId, plan.ssrMonthlyBudgetUsd, source.zip);
  } finally {
    // The staged upload is only needed until it's read; the build keeps its own copy (ssr/latest.zip).
    if (source.stagedKey) await deleteObject(source.stagedKey).catch(() => undefined);
  }
}

async function readSource(request: NextRequest, templateId: string): Promise<Source> {
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const body = await request.json().catch(() => null);
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

async function queueBuild(
  resolved: ResolvedUser,
  templateId: string,
  budgetUsd: number,
  sourceZip: Uint8Array,
): Promise<NextResponse> {
  const inspected = await inspectSsrSource(sourceZip);
  if (!inspected.ok) {
    return NextResponse.json({ error: inspected.error }, { status: 400 });
  }

  // Reserve this build's projected cost first, so concurrent uploads can't overspend the month.
  const reservation = await reserveSsrBuild({ organizationId: resolved.organizationId, budgetUsd });
  if (!reservation.ok) {
    return NextResponse.json({
      error: `This month's server build budget is used up ($${reservation.usedUsd.toFixed(2)} of $${reservation.budgetUsd.toFixed(2)} projected). It resets on the first of next month.`,
    }, { status: 429 });
  }

  try {
    // Build-time variables for the preview. The build bakes them in, so publish compares against this.
    const buildVars = buildVariablesFor(await listSsrVariables(templateId), "dev");
    const build = await startSsrBuild({
      templateId,
      organizationId: resolved.organizationId,
      requestedBy: resolved.userId,
      sourceZip,
      framework: inspected.framework,
      root: inspected.root,
      publicEnv: buildVars,
    });
    const hash = buildVarsHash(buildVars);
    const { data: existing } = await DeployedApp.get({ templateId }).go();
    if (existing) await markBuildQueued(templateId, hash);
    else await DeployedApp.create({ templateId, type: "SSR", previewBuildVarsHash: hash }).go();
    return NextResponse.json(
      {
        buildId: build.id,
        status: build.status,
        framework: inspected.framework,
        functionName: ssrFunctionName(templateId, "preview"),
        warnings: inspected.warnings,
        message: "Source received. The server build is queued; the app goes live when it succeeds.",
      },
      { status: 202 },
    );
  } catch (err) {
    await releaseSsrBuild({ organizationId: resolved.organizationId });
    if (err instanceof BuildUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }
}
