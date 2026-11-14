import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { DeployedApp } from "@/lib/db/appEntities";
import { getTierFeatures } from "@/lib/subscription";
import { queueSsrControl } from "@/lib/appFunctions/ssrControl";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET  /api/v1/templates/:id/ssr-always-on  → { request: NONE | REQUESTED | APPROVED | DECLINED, requestedAt, decidedAt }
 * POST /api/v1/templates/:id/ssr-always-on  → asks Plexo to keep one warm copy of the app running (always on).
 *
 * Nothing is switched on here. Plexo reviews each request by hand (a warm copy costs about $11 a month,
 * more than the plan's SSR budget), and only an approved request is ever turned on.
 * ULTRA plan only, like the rest of the server app routes.
 */
async function ownedSsrApp(request: NextRequest, templateId: string) {
  const resolved = await resolveUser(request);
  if (!resolved) return { error: NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 }) };
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return { error: NextResponse.json({ error: `No template found with id "${templateId}" for this account.` }, { status: 404 }) };
  }
  if (!getTierFeatures(resolved.subscriptionPlan).ssrEnabled) {
    return { error: NextResponse.json({ error: "Server-rendered apps are available on the ULTRA plan." }, { status: 403 }) };
  }
  const { data: app } = await DeployedApp.get({ templateId }).go();
  if (!app || app.type !== "SSR") {
    return { error: NextResponse.json({ error: "Build and publish the server app before asking for always-on." }, { status: 409 }) };
  }
  return { app };
}

export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id: templateId } = await params;
  const check = await ownedSsrApp(request, templateId);
  if (check.error) return check.error;
  return NextResponse.json({
    request: check.app.alwaysOnRequest ?? "NONE",
    requestedAt: check.app.alwaysOnRequestedAt ?? null,
    decidedAt: check.app.alwaysOnDecidedAt ?? null,
    status: check.app.alwaysOnStatus ?? "OFF",
    error: check.app.alwaysOnError || null,
  });
}

export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id: templateId } = await params;
  const check = await ownedSsrApp(request, templateId);
  if (check.error) return check.error;
  const body = await request.json().catch(() => ({}));
  // Turning off an approved always-on copy. The finalizer releases it and returns the app to cold starts.
  if (body.action === "turnOff") {
    if (check.app.alwaysOnRequest !== "APPROVED") {
      return NextResponse.json({ error: "Always-on isn't on for this app." }, { status: 400 });
    }
    await queueSsrControl({ kind: "alwaysOn", templateId, enabled: false });
    return NextResponse.json({ request: "APPROVED", message: "Turning off. The app goes back to cold starts shortly." }, { status: 202 });
  }
  // Already decided or already waiting: nothing new to record.
  if (check.app.alwaysOnRequest === "REQUESTED" || check.app.alwaysOnRequest === "APPROVED") {
    return NextResponse.json({ request: check.app.alwaysOnRequest, message: check.app.alwaysOnRequest === "APPROVED" ? "Always-on is approved for this app." : "Already requested. Plexo will review it." });
  }
  const now = new Date().toISOString();
  await DeployedApp.patch({ templateId }).set({ alwaysOnRequest: "REQUESTED", alwaysOnRequestedAt: now }).go();
  return NextResponse.json({ request: "REQUESTED", requestedAt: now, message: "Requested. Plexo reviews always-on requests by hand, then turns it on for this app." }, { status: 202 });
}
