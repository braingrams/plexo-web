import { NextRequest, NextResponse } from "next/server";
import { appContextByTemplate, appContextFor } from "@/lib/appRuntime/context";
import { parseState, consumeOAuthState, finishGoogleSignIn } from "@/lib/appAuth/oauth";
import { safeRedirect } from "@/lib/appAuth/service";
import { requestMeta } from "@/lib/appRuntime/http";

/**
 * GET /api/app-oauth/google/callback
 *
 * Google's one fixed redirect for "Sign in with Google" on apps built on Plexo that haven't
 * set up their own Google client (lib/appAuth/oauth.ts). The state names the app and
 * environment; the one-time token inside it proves the flow started there and records the
 * host it started on. The visitor is signed in to THAT app's database, then sent back to the
 * app's own host with a one-time code, where the session cookie is set first-party.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const q = request.nextUrl.searchParams;
  const state = parseState(q.get("state"));
  const fail = (message: string) =>
    new NextResponse(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign-in didn't finish</title><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b0f19;color:#f0f2ff;text-align:center"><div style="max-width:420px;padding:24px"><h1 style="font-size:22px;color:#a78bfa">Sign-in didn't finish</h1><p style="opacity:.75;line-height:1.6">${message.replace(/[<>&]/g, "")}</p><p style="opacity:.75">Go back to the app and try again.</p></div></body>`,
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
    );
  if (!state) return fail("That sign-in link isn't valid.");

  const dbCtx = await appContextByTemplate(state.templateId, state.env);
  if (!dbCtx) return fail("That app no longer exists.");
  const st = await consumeOAuthState(dbCtx, state.token);
  if (!st) return fail("That sign-in attempt expired.");
  // The host the flow started on must really serve this app + environment.
  const ctx = await appContextFor(state.templateId, state.env, st.host);
  if (!ctx) return fail("That app isn't available at the address you started from.");
  try {
    const result = await finishGoogleSignIn(ctx, { code: q.get("code"), state: st, via: "platform" }, requestMeta(request));
    return NextResponse.redirect(result.redirectTo, 303);
  } catch (err) {
    const back = new URL(safeRedirect(ctx, st.redirectTo));
    back.searchParams.set("auth_error", err instanceof Error ? err.message : "Sign-in failed.");
    return NextResponse.redirect(back.toString(), 303);
  }
}
