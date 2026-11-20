import { NextRequest, NextResponse } from "next/server";
import { authorizeSite } from "@/lib/sites/authorizeSite";
import { buildAuthUrl, createPkce, createState, isGoogleAnalyticsConfigured, isGoogleAnalyticsMock, OAUTH_COOKIE } from "@/lib/googleAnalytics/oauth";
import { getConnection, provisionSite, saveRefreshToken } from "@/lib/googleAnalytics/connection";
import { backTo } from "@/lib/googleAnalytics/backTo";
import { canUseGoogleAnalytics } from "@/lib/googleAnalytics/access";

/** GET ?siteId= — the "Connect Google Analytics" button. Sends the owner to Google's own sign-in. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const siteId = new URL(request.url).searchParams.get("siteId") ?? "";
  const a = await authorizeSite(request, siteId);
  if (a.error) return NextResponse.redirect(new URL(`/auth/login?redirectTo=${encodeURIComponent(`/dashboard/sites/${siteId}?tab=visits`)}`, request.url));

  // Paid plans only: checked here, not just hidden in the page.
  if (!canUseGoogleAnalytics(a.user.subscriptionPlan)) return backTo(request, a.site.id, "upgrade");

  if (isGoogleAnalyticsMock()) {
    // No Google credentials in dev: pretend the owner signed in so the whole flow can be tried.
    await saveRefreshToken({ templateId: a.site.id, organizationId: a.site.organizationId, userId: a.user.userId, refreshToken: "mock", googleEmail: "you@example.com" });
    const conn = await getConnection(a.site.id);
    if (conn) await provisionSite(conn).catch(() => undefined);
    return backTo(request, a.site.id, "connected");
  }
  if (!isGoogleAnalyticsConfigured()) return backTo(request, a.site.id, "unavailable");

  const { state, nonce } = createState(a.site.id, a.user.userId);
  const { verifier, challenge } = createPkce();
  const res = NextResponse.redirect(buildAuthUrl({ state, challenge }));
  // The code verifier and nonce stay in this browser only, for the ten minutes the sign-in may take.
  res.cookies.set(OAUTH_COOKIE, JSON.stringify({ v: verifier, n: nonce }), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/google-analytics", maxAge: 600 });
  return res;
}
