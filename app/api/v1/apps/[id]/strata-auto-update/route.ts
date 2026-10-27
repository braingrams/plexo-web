import { NextRequest, NextResponse } from "next/server";
import { StrataError } from "@charisol/plexo-sdk/v2/strata";
import { loadApp, appError } from "@/lib/projects/appAccess";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { strataApiUrl, strataFail } from "@/lib/strata/server";
import { AutoUpdateError, disableAutoUpdate, enableAutoUpdate, getAutoUpdateState } from "@/lib/strata/autoUpdate";

type Ctx = { params: Promise<{ id: string }> };

/**
 * "Keep my website up to date with Strata" for one app (lib/strata/autoUpdate.ts).
 *   GET    → { enabled, status: "active" | "needs-reconnect" | "off", lastCheckedAt, lastResult, lastResultKind }
 *          (lastResult is plain language for the Design tab; no key is ever included)
 *   POST   → turns it on: needs the app linked to a Strata project and the owner's Strata
 *          connection; the key Strata issues stays on the server. → same shape as GET
 *   DELETE → turns it off: the key is revoked in Strata and forgotten. → same shape as GET
 */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  try {
    return NextResponse.json({ available: !!strataApiUrl(), ...(await getAutoUpdateState(id)) });
  } catch (err) {
    return appError(err);
  }
}

async function change(request: NextRequest, { params }: Ctx, on: boolean): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  if (!strataApiUrl()) return NextResponse.json({ error: "Strata isn't set up on this Plexo yet.", kind: "unavailable" }, { status: 503 });
  if (!(await checkCommerceRateLimit(`strata:auto-update:${loaded.resolved.userId}`, 20))) {
    return NextResponse.json({ error: "That's a lot of requests in a short time. Wait a few minutes and try again.", kind: "rate_limited" }, { status: 429 });
  }
  try {
    const state = on
      ? await enableAutoUpdate({ appId: id, appName: loaded.app.name, userId: loaded.resolved.userId })
      : await disableAutoUpdate({ appId: id, userId: loaded.resolved.userId });
    return NextResponse.json({ available: true, ...state });
  } catch (err) {
    if (err instanceof AutoUpdateError) return NextResponse.json({ error: err.message, kind: err.status === 401 ? "expired" : err.status === 403 ? "forbidden" : "invalid" }, { status: err.status });
    if (err instanceof StrataError) return strataFail(err);
    return appError(err);
  }
}

export const POST = (request: NextRequest, ctx: Ctx) => change(request, ctx, true);
export const DELETE = (request: NextRequest, ctx: Ctx) => change(request, ctx, false);
