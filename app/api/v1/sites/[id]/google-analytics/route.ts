import { planGateBody } from "@/lib/plan/planGate";
import { NextRequest, NextResponse } from "next/server";
import { authorizeSite } from "@/lib/sites/authorizeSite";
import { isGoogleAnalyticsConfigured, isGoogleAnalyticsMock } from "@/lib/googleAnalytics/oauth";
import { accessTokenFor, adminClientFor, disconnect, getConnection, GoogleApiError, markNeedsReconnect, provisionSite, reportForSite, siteUrlFor, startManaged } from "@/lib/googleAnalytics/connection";
import { GoogleAuthError } from "@/lib/googleAnalytics/oauth";
import { buildInsights } from "@/lib/googleAnalytics/insights";
import { ANALYTICS_UPGRADE_MESSAGE, canUseGoogleAnalytics } from "@/lib/googleAnalytics/access";
import { EMAIL_PATTERN, grantAccess, isManagedAvailable, isManagedMock, ManagedUnavailableError } from "@/lib/googleAnalytics/managed";
import { SiteGoogleAnalytics } from "@/lib/db/opsEntities";
import type { RangeDays } from "@/lib/googleAnalytics/types";

/**
 * A site's detailed visitor numbers (Plexo-managed Google Analytics, or the owner's own Google account), for the Visits tab.
 *   GET ?days=7|28|90  → { state, … } where state is one of: upgrade, unavailable, not_connected, choose, needs_account, needs_reconnect, ready, error
 *   POST { action }    → "use_plexo" | "choose" (propertyName, accountName, propertyDisplayName) | "create_new" | "retry" | "hand_over" (email) | "disconnect"
 * Everything except "disconnect" needs a paid plan, checked here on the server (the page only mirrors it).
 * Google's refresh token never leaves the server, and a site is only ever read through the property stored on its own row.
 */
type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 30;

const RANGES: RangeDays[] = [7, 28, 90];
const JUST_CONNECTED_MS = 48 * 3600 * 1000;

function options() {
  return { managed: isManagedAvailable(), own: isGoogleAnalyticsConfigured() || isGoogleAnalyticsMock() };
}

export async function GET(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const a = await authorizeSite(request, (await ctx.params).id);
  if (a.error) return a.error;
  if (!canUseGoogleAnalytics(a.user.subscriptionPlan)) return NextResponse.json({ state: "upgrade", message: ANALYTICS_UPGRADE_MESSAGE });
  const opts = options();
  if (!opts.managed && !opts.own) return NextResponse.json({ state: "unavailable" });

  const conn = await getConnection(a.site.id);
  // Sample numbers: the real Google isn't connected in this environment (dev and previews only).
  const mock = conn ? (conn.mode === "managed" ? isManagedMock() : isGoogleAnalyticsMock()) : isManagedMock() || isGoogleAnalyticsMock();
  if (!conn) return NextResponse.json({ state: "not_connected", options: opts, mock });
  const base = { mock, mode: conn.mode ?? "own", googleEmail: conn.googleEmail ?? null, propertyName: conn.propertyDisplayName ?? null, handedOverTo: conn.handedOverTo ?? null, options: opts };
  if (conn.status === "needs_reconnect") return NextResponse.json({ state: "needs_reconnect", ...base });
  if (!conn.measurementId || !conn.propertyName) {
    try {
      const properties = await adminClientFor(await accessTokenFor(conn)).listProperties();
      if (properties.length > 1) return NextResponse.json({ state: "choose", choices: properties, ...base });
      if (properties.length === 0 && !mock) return NextResponse.json({ state: "needs_account", ...base });
    } catch (err) {
      return errorState(err, a.site.id, base);
    }
    return NextResponse.json({ state: "choose", choices: [], ...base });
  }

  const requested = Number(new URL(request.url).searchParams.get("days"));
  const days = (RANGES.includes(requested as RangeDays) ? requested : 28) as RangeDays;
  try {
    const report = await reportForSite(conn, a.site.id, days);
    const justConnected = report.totals.visitors === 0 && Date.now() - new Date(conn.connectedAt ?? 0).getTime() < JUST_CONNECTED_MS;
    return NextResponse.json({ state: "ready", measurementId: conn.measurementId, connectedAt: conn.connectedAt, justConnected, report, insights: buildInsights(report), ...base });
  } catch (err) {
    return errorState(err, a.site.id, base);
  }
}

async function errorState(err: unknown, siteId: string, base: Record<string, unknown>): Promise<NextResponse> {
  // Plexo's own property can only be fixed by Plexo: never ask the owner to "sign in again" for it.
  if (base.mode !== "managed") {
    const needsReconnect = (err instanceof GoogleAuthError && err.needsReconnect) || (err instanceof GoogleApiError && err.needsReconnect);
    if (needsReconnect) {
      await markNeedsReconnect(siteId);
      return NextResponse.json({ state: "needs_reconnect", ...base });
    }
  }
  // Never echo Google's raw error; it can carry request details.
  console.error("google analytics read failed:", err instanceof Error ? err.message : "unknown error");
  return NextResponse.json({ state: "error", ...base });
}

export async function POST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const a = await authorizeSite(request, (await ctx.params).id);
  if (a.error) return a.error;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; propertyName?: unknown; accountName?: unknown; propertyDisplayName?: unknown; email?: unknown };

  // Turning it off is always allowed, even after a plan ended.
  if (body.action === "disconnect") {
    await disconnect(a.site.id);
    return NextResponse.json({ ok: true });
  }
  if (!canUseGoogleAnalytics(a.user.subscriptionPlan)) return NextResponse.json({ ...planGateBody("PLAN_ANALYTICS", ANALYTICS_UPGRADE_MESSAGE), state: "upgrade" }, { status: 402 });
  if (!(await siteUrlFor(a.site.id))) return NextResponse.json({ error: "Publish your site first. Google needs its web address to measure it." }, { status: 409 });

  try {
    if (body.action === "use_plexo") {
      if (!isManagedAvailable()) return NextResponse.json({ error: "Plexo's visitor numbers aren't switched on here yet. Your simple visit counts keep working." }, { status: 503 });
      await startManaged({ id: a.site.id, organizationId: a.site.organizationId }, a.user.userId);
      return NextResponse.json({ outcome: "done" });
    }

    const conn = await getConnection(a.site.id);
    if (!conn) return NextResponse.json({ error: "Turn on visitor numbers first." }, { status: 409 });

    if (body.action === "hand_over") {
      if (conn.mode !== "managed" || !conn.propertyName) return NextResponse.json({ error: "This site already uses your own Google account." }, { status: 409 });
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!EMAIL_PATTERN.test(email)) return NextResponse.json({ error: "Type the email address of your Google account, for example you@gmail.com." }, { status: 400 });
      try {
        await grantAccess(conn.propertyName, email);
      } catch (err) {
        if (err instanceof GoogleApiError && err.status === 400) return NextResponse.json({ error: "Google doesn't know that email as a Google account. Use the address you sign in to Google with." }, { status: 400 });
        throw err;
      }
      await SiteGoogleAnalytics.patch({ templateId: a.site.id }).set({ handedOverTo: email, handedOverAt: new Date().toISOString() }).go();
      return NextResponse.json({ ok: true });
    }

    // The remaining steps belong to "use my own Google account".
    if (conn.mode === "managed") return NextResponse.json({ error: "Plexo is already looking after this for you." }, { status: 409 });
    if (body.action === "choose") {
      if (typeof body.propertyName !== "string" || !/^properties\/\d+$/.test(body.propertyName) || typeof body.accountName !== "string" || !/^accounts\/\d+$/.test(body.accountName)) {
        return NextResponse.json({ error: "Pick one of the options in the list." }, { status: 400 });
      }
      const outcome = await provisionSite(conn, { choice: { accountName: body.accountName, propertyName: body.propertyName, propertyDisplayName: typeof body.propertyDisplayName === "string" ? body.propertyDisplayName.slice(0, 100) : "Your property" } });
      return NextResponse.json({ outcome: outcome.status });
    }
    if (body.action === "create_new" || body.action === "retry") {
      const outcome = await provisionSite(conn, { createNew: body.action === "create_new" });
      return NextResponse.json({ outcome: outcome.status });
    }
  } catch (err) {
    if (err instanceof ManagedUnavailableError) {
      return NextResponse.json({ error: err.reason === "full" ? "Detailed numbers are very busy right now. Your simple visit counts keep working. Please try again in a day or two." : "Plexo's visitor numbers aren't switched on here yet. Your simple visit counts keep working." }, { status: 503 });
    }
    if ((err instanceof GoogleApiError || err instanceof GoogleAuthError) && err.needsReconnect && body.action !== "use_plexo" && body.action !== "hand_over") {
      await markNeedsReconnect(a.site.id);
      return NextResponse.json({ error: "Google needs you to sign in again.", state: "needs_reconnect" }, { status: 409 });
    }
    console.error("google analytics setup failed:", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "We couldn't finish setting up your visitor numbers. Please try again in a minute." }, { status: 502 });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
