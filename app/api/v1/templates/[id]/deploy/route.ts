import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { processDeployZip, DeployError } from "@/lib/pub/processDeployZip";
import { DeployedApp } from "@/lib/db/appEntities";
import { resolveHostingTier, type HostingTier } from "@/lib/pub/hostingTier";
import { getTierFeatures } from "@/lib/subscription";
import { updateProvisionedConcurrency } from "@/lib/pub/updateProvisionedConcurrency";

const MAX_ZIP_BYTES = 50 * 1024 * 1024;

/**
 * POST /api/v1/templates/:id/deploy
 *
 * Single-shot deploy — accepts a multipart form with a `file` field containing a .zip of
 * the build output. Works for zips that fit within Lambda's 6 MB request-payload limit
 * (roughly 4.5 MB unencoded). For larger zips use POST .../deploy/chunk instead.
 *
 * The authenticated user must be a member of the organization that owns the template.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 });
  }

  const { id: templateId } = await context.params;
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: `No template found with id "${templateId}" for this account.` }, { status: 404 });
  }

  const tier = resolveHostingTier(request, resolved.subscriptionPlan);
  if ("error" in tier) return tier.error;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data with a 'file' field." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded. POST a multipart form with a 'file' field containing a .zip of your build output." }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".zip")) {
    return NextResponse.json({ error: "Only .zip files are accepted. Zip the contents of your dist/ (or out/ or build/) directory." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > MAX_ZIP_BYTES) {
    return NextResponse.json({ error: `Zip exceeds the ${MAX_ZIP_BYTES / 1024 / 1024}MB limit.` }, { status: 400 });
  }

  try {
    const result = await processDeployZip(buffer, templateId, { hostingTier: tier.hostingTier });
    return NextResponse.json({
      ok: true,
      ...result,
      message: `Deployed ${result.fileCount} file${result.fileCount !== 1 ? "s" : ""} as a ${result.framework} site. Your domain is now serving the new build.`,
    });
  } catch (err) {
    if (err instanceof DeployError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

/**
 * GET /api/v1/templates/:id/deploy
 *
 * Returns the current deployment state: hosting tier, framework, SPA mode,
 * redirect rule count, and timestamps.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 });
  }

  const { id: templateId } = await context.params;
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: `No template found with id "${templateId}" for this account.` }, { status: 404 });
  }

  const { data: deployedApp } = await DeployedApp.get({ templateId }).go();
  if (!deployedApp) {
    return NextResponse.json({ error: "No deployment found for this site. Deploy a build first with POST." }, { status: 404 });
  }

  return NextResponse.json({
    templateId,
    type: deployedApp.type,
    hostingTier: deployedApp.hostingTier ?? "LAMBDA",
    framework: deployedApp.framework,
    spaMode: deployedApp.spaMode ?? false,
    redirectRules: Array.isArray(deployedApp.redirectRules) ? (deployedApp.redirectRules as unknown[]).length : 0,
    updatedAt: deployedApp.updatedAt,
    createdAt: deployedApp.createdAt,
  });
}

/**
 * PATCH /api/v1/templates/:id/deploy
 *
 * Changes the hosting tier of an existing deployment without re-uploading.
 * Body: `{ "hostingTier": "STATIC" | "LAMBDA" | "PROVISIONED" }`
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 });
  }

  const { id: templateId } = await context.params;
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: `No template found with id "${templateId}" for this account.` }, { status: 404 });
  }

  const { data: deployedApp } = await DeployedApp.get({ templateId }).go();
  if (!deployedApp) {
    return NextResponse.json({ error: "No deployment found for this site. Deploy a build first with POST." }, { status: 404 });
  }

  let body: { hostingTier?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a `hostingTier` field." }, { status: 400 });
  }

  const VALID_TIERS = new Set<string>(["STATIC", "LAMBDA", "PROVISIONED"]);
  const requested = typeof body.hostingTier === "string" ? body.hostingTier.toUpperCase() : null;
  if (!requested || !VALID_TIERS.has(requested)) {
    return NextResponse.json({
      error: `"hostingTier" must be one of: STATIC, LAMBDA, PROVISIONED. Got: ${JSON.stringify(body.hostingTier)}.`,
    }, { status: 400 });
  }

  const hostingTier = requested as HostingTier;
  const allowedTiers = getTierFeatures(resolved.subscriptionPlan).deployedAppHostingTiers;
  if (!allowedTiers.includes(hostingTier)) {
    return NextResponse.json({
      error: `Your plan does not include the "${hostingTier}" hosting tier. Available on this plan: ${allowedTiers.join(", ")}. Upgrade to access faster hosting options.`,
    }, { status: 403 });
  }

  const previousTier = deployedApp.hostingTier ?? "LAMBDA";
  await DeployedApp.update({ templateId }).set({ hostingTier }).go();

  // Recalculate Lambda provisioned concurrency whenever a customer moves to or from
  // PROVISIONED tier. Fire-and-forget: the PC update completes asynchronously (Lambda's
  // PutProvisionedConcurrencyConfig takes a few seconds) but the customer's tier is already
  // stored in DynamoDB, so re-deploys and new requests immediately use the new tier label.
  if (hostingTier === "PROVISIONED" || previousTier === "PROVISIONED") {
    void updateProvisionedConcurrency().catch(console.error);
  }

  return NextResponse.json({
    ok: true,
    hostingTier,
    message: `Hosting tier changed to ${hostingTier}.`,
  });
}
