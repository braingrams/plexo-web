import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { DeployedApp } from "@/lib/db/appEntities";
import { queueSsrControl } from "@/lib/appFunctions/ssrControl";

/**
 * POST /api/internal/always-on   header: x-always-on-secret: <ALWAYS_ON_SECRET>
 * body: { templateId, decision: "approve" | "decline" }
 *
 * Called by the admin app when a reviewer decides an always-on request. Approving queues the change; the
 * warm copy is switched on by BuildFinalizeFn (lib/appFunctions/alwaysOn.ts), which is the only role allowed to change functions.
 */
function secretMatches(given: string | null): boolean {
  const expected = process.env.ALWAYS_ON_SECRET;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!process.env.ALWAYS_ON_SECRET) {
    return NextResponse.json({ error: "Always-on decisions aren't configured in this environment." }, { status: 503 });
  }
  if (!secretMatches(request.headers.get("x-always-on-secret"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const templateId = typeof body.templateId === "string" ? body.templateId : "";
  if (!/^[A-Za-z0-9_-]{1,50}$/.test(templateId)) return NextResponse.json({ error: "templateId is required." }, { status: 400 });
  if (body.decision !== "approve" && body.decision !== "decline") {
    return NextResponse.json({ error: 'decision must be "approve" or "decline".' }, { status: 400 });
  }

  const { data: app } = await DeployedApp.get({ templateId }).go({ attributes: ["alwaysOnRequest"] });
  if (!app) return NextResponse.json({ error: "Server app not found." }, { status: 404 });
  if (app.alwaysOnRequest !== "REQUESTED") {
    return NextResponse.json({ error: "There is no pending always-on request for this app." }, { status: 400 });
  }

  const now = new Date().toISOString();
  if (body.decision === "decline") {
    await DeployedApp.patch({ templateId }).set({ alwaysOnRequest: "DECLINED", alwaysOnDecidedAt: now }).go();
    return NextResponse.json({ alwaysOnRequest: "DECLINED" });
  }

  // Approve: record it, then queue the switch-on. The finalizer does the work and retries on failure.
  await DeployedApp.patch({ templateId }).set({ alwaysOnRequest: "APPROVED", alwaysOnDecidedAt: now }).go();
  await queueSsrControl({ kind: "alwaysOn", templateId, enabled: true });
  return NextResponse.json({ alwaysOnRequest: "APPROVED", message: "Approved. The warm copy is being switched on." }, { status: 202 });
}
