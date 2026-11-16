import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { PublishedDomain, Template } from "@/lib/db/contentEntities";
import { DeployedApp } from "@/lib/db/appEntities";
import { isDomainLive } from "@/lib/plan/siteLimits";
import { queueSsrControl } from "@/lib/appFunctions/ssrControl";
import { getTierFeatures } from "@/lib/subscription";

/**
 * POST /api/v1/templates/:id/ssr-publish
 *   Queues the publish of the app's latest SSR preview. It runs in BuildFinalizeFn, which is the only
 *   role that may change the live function. → 202. Poll GET for the outcome.
 *
 * GET /api/v1/templates/:id/ssr-publish
 *   → { publishing, requestedAt, finishedAt, error, warnings }
 *
 * Pro plan and above.
 */

type Ctx = { params: Promise<{ id: string }> };

async function ownedTemplate(request: NextRequest, templateId: string): Promise<{ error: NextResponse } | { ok: true }> {
  const resolved = await resolveUser(request);
  if (!resolved) return { error: NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 }) };
  if (!getTierFeatures(resolved.subscriptionPlan).ssrEnabled) {
    return { error: NextResponse.json({ error: "Server apps are part of the Pro plan. Upgrade in Settings → Billing to use them." }, { status: 403 }) };
  }
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return { error: NextResponse.json({ error: `No template found with id "${templateId}" for this account.` }, { status: 404 }) };
  }
  return { ok: true };
}

export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id: templateId } = await params;
  const check = await ownedTemplate(request, templateId);
  if ("error" in check) return check.error;

  const { data: app } = await DeployedApp.get({ templateId }).go();
  if (!app?.previewBundleKey || !app.previewBuildId || !app.previewSitePrefix) {
    return NextResponse.json({ error: "There's no SSR preview to publish. Upload the server build first." }, { status: 409 });
  }
  const requestedAt = new Date().toISOString();
  await DeployedApp.patch({ templateId }).set({ publishRequestedAt: requestedAt, publishError: "", publishWarnings: "[]" }).go();
  try {
    await queueSsrControl({ kind: "publish", templateId });
  } catch (err) {
    console.error("queueing the SSR publish failed", err);
    return NextResponse.json({ error: "Couldn't start the publish. Try again." }, { status: 503 });
  }
  return NextResponse.json({ status: "publishing", requestedAt, message: "Publishing started. The live site switches when it finishes." }, { status: 202 });
}

export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id: templateId } = await params;
  const check = await ownedTemplate(request, templateId);
  if ("error" in check) return check.error;

  const { data: app } = await DeployedApp.get({ templateId }).go();
  const requestedAt = app?.publishRequestedAt ?? null;
  const finishedAt = app?.publishFinishedAt ?? null;
  const publishing = !!requestedAt && (!finishedAt || finishedAt < requestedAt);
  let warnings: string[] = [];
  try {
    warnings = JSON.parse(app?.publishWarnings || "[]") as string[];
  } catch {
    warnings = [];
  }
  // The live address, once the app is live. The wizard uses it for its success screen.
  let liveUrl: string | null = null;
  if (app?.functionUrl) {
    const { data: domains } = await PublishedDomain.query.primary({ templateId }).go({ pages: "all" });
    const live = domains.find(isDomainLive);
    if (live) liveUrl = `https://${live.domain}`;
  }
  return NextResponse.json({
    publishing,
    requestedAt,
    finishedAt,
    error: app?.publishError || null,
    warnings,
    previewReady: Boolean(app?.previewBundleKey),
    liveUrl,
  });
}
