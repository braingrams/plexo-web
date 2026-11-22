import { NextRequest, NextResponse } from "next/server";
import { authorizeSite } from "@/lib/sites/authorizeSite";
import { emailFromIdToken, exchangeCode, hasRequiredScopes, OAUTH_COOKIE, verifyState } from "@/lib/googleAnalytics/oauth";
import { getConnection, provisionSite, saveRefreshToken } from "@/lib/googleAnalytics/connection";
import { backTo } from "@/lib/googleAnalytics/backTo";
import { canUseGoogleAnalytics } from "@/lib/googleAnalytics/access";

/** Google sends the owner back here. Nothing in this route logs a code or a token. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const state = verifyState(params.get("state"));
  const raw = request.cookies.get(OAUTH_COOKIE)?.value;
  let cookie: { v?: string; n?: string } = {};
  try {
    cookie = raw ? (JSON.parse(raw) as { v?: string; n?: string }) : {};
  } catch {
    cookie = {};
  }
  const clear = (res: NextResponse) => {
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/google-analytics", maxAge: 0 });
    return res;
  };
  // Signed, unexpired, and started from this very browser.
  if (!state || !cookie.v || cookie.n !== state.nonce) return clear(NextResponse.redirect(new URL("/dashboard", request.url)));

  const a = await authorizeSite(request, state.siteId);
  if (a.error || a.user.userId !== state.userId) return clear(NextResponse.redirect(new URL("/dashboard", request.url)));

  // The plan may have ended while the owner was on Google's page.
  if (!canUseGoogleAnalytics(a.user.subscriptionPlan)) return clear(backTo(request, state.siteId, "upgrade"));

  const code = params.get("code");
  if (params.get("error") || !code) return clear(backTo(request, state.siteId, "cancelled"));

  try {
    const tokens = await exchangeCode(code, cookie.v);
    if (!tokens.refreshToken) return clear(backTo(request, state.siteId, "failed"));
    if (!hasRequiredScopes(tokens.scope)) return clear(backTo(request, state.siteId, "permissions"));
    await saveRefreshToken({ templateId: state.siteId, organizationId: a.site.organizationId, userId: a.user.userId, refreshToken: tokens.refreshToken, googleEmail: emailFromIdToken(tokens.idToken) });
    const conn = await getConnection(state.siteId);
    let result = "connected";
    if (conn) {
      try {
        const outcome = await provisionSite(conn);
        result = outcome.status === "done" ? "connected" : outcome.status === "choose" ? "choose" : "needs_account";
      } catch {
        result = "setup_failed";
      }
    }
    return clear(backTo(request, state.siteId, result));
  } catch (err) {
    console.error("google analytics callback failed:", err instanceof Error ? err.message : "unknown error");
    return clear(backTo(request, state.siteId, "failed"));
  }
}
