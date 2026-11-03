import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { inspectSsrSource, SSR_MAX_ZIP_BYTES } from "@/lib/projects/ssrSource";
import { startSsrBuild, BuildUnavailableError } from "@/lib/projects/builds";
import { getTierFeatures } from "@/lib/subscription";
import { reserveSsrBuild, releaseSsrBuild } from "@/lib/projects/ssrBudget";
import { ssrFunctionName } from "@/lib/appFunctions/ssrNames";

/**
 * POST /api/v1/templates/:id/ssr-deploy
 *
 * Uploads a server-rendered app as a .zip of its source (package.json at the root, or inside a
 * single wrapper folder). The framework is detected from package.json, the zip is stored, and an
 * SSR build is queued. The build produces the per-customer Lambda `plexo-ssr-<templateId>`.
 *
 * Responds 202 with the build to poll; the function isn't live until that build succeeds.
 */

// Lambda function names must be 64 characters or fewer and use [A-Za-z0-9_-]. The prefix uses 10.
const TEMPLATE_ID_PATTERN = /^[A-Za-z0-9_-]{1,50}$/;

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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data with a 'file' field." }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded. POST a multipart form with a 'file' field containing a .zip of the app's source." }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".zip")) {
    return NextResponse.json({ error: "Only .zip files are accepted. Zip the project folder that contains package.json." }, { status: 400 });
  }
  if (file.size > SSR_MAX_ZIP_BYTES) {
    return NextResponse.json({ error: `Zip exceeds the ${SSR_MAX_ZIP_BYTES / 1024 / 1024}MB limit.` }, { status: 400 });
  }

  const sourceZip = new Uint8Array(await file.arrayBuffer());
  const inspected = await inspectSsrSource(sourceZip);
  if (!inspected.ok) {
    return NextResponse.json({ error: inspected.error }, { status: 400 });
  }

  // Reserve this build's projected cost first, so concurrent uploads can't overspend the month.
  const reservation = await reserveSsrBuild({ organizationId: resolved.organizationId, budgetUsd: plan.ssrMonthlyBudgetUsd });
  if (!reservation.ok) {
    return NextResponse.json({
      error: `This month's server build budget is used up ($${reservation.usedUsd.toFixed(2)} of $${reservation.budgetUsd.toFixed(2)} projected). It resets on the first of next month.`,
    }, { status: 429 });
  }

  try {
    const build = await startSsrBuild({
      templateId,
      organizationId: resolved.organizationId,
      requestedBy: resolved.userId,
      sourceZip,
      framework: inspected.framework,
      root: inspected.root,
    });
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
