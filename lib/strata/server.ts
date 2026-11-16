import { NextRequest, NextResponse } from "next/server";
import { createStrataClient, StrataError, type StrataErrorKind } from "@charisol/plexo-sdk/v2/strata";
import { resolveUser } from "@/lib/auth/resolveUser";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { loadStrataToken } from "./session";

// Shared plumbing for the /api/v1/strata/* routes: is Strata set up, who is asking, how often,
// a Strata client acting as that person, and Strata's errors turned into plain-language
// responses the editor can show (and, for an ended session, answer with "Reconnect").

import { strataApiUrl } from "./apiUrl";

export { strataApiUrl };

const STATUS_FOR_KIND: Record<StrataErrorKind, number> = {
  expired: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid: 400,
  network: 502,
  server: 502,
};

/** `kind` lets the browser tell "Strata says your session ended" apart from "you're signed out of Plexo". */
export function strataFail(err: unknown): NextResponse {
  if (err instanceof StrataError) {
    const status = err.kind === "invalid" && err.status === 409 ? 409 : STATUS_FOR_KIND[err.kind];
    return NextResponse.json({ error: err.message, kind: err.kind }, { status });
  }
  console.error("strata route error:", err);
  return NextResponse.json({ error: "Something went wrong talking to Strata. Please try again in a moment.", kind: "server" }, { status: 500 });
}

export type StrataCaller = { userId: string; organizationId: string; client: ReturnType<typeof createStrataClient> };

/**
 * Signs the caller in (Plexo session or API key), checks Strata is configured and applies the
 * rate limit. Returns the caller with a Strata client, or the response to send instead.
 */
export async function authorizeStrata(request: NextRequest, bucket: string, limit: number): Promise<StrataCaller | NextResponse> {
  const base = strataApiUrl();
  if (!base) {
    return NextResponse.json({ error: "Strata isn't set up on this Plexo yet, so there's nothing to connect.", kind: "unavailable" }, { status: 503 });
  }
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Sign in to Plexo to continue.", kind: "unauthorized" }, { status: 401 });
  if (!(await checkCommerceRateLimit(`strata:${bucket}:${resolved.userId}`, limit))) {
    return NextResponse.json({ error: "That's a lot of requests in a short time. Wait a few minutes and try again.", kind: "rate_limited" }, { status: 429 });
  }
  const userId = resolved.userId;
  return { userId, organizationId: resolved.organizationId, client: createStrataClient({ baseUrl: base, getToken: () => loadStrataToken(userId) }) };
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** Trades a verified Charisol ID token for a Strata session (POST /auth/charisol-id-token). */
export async function exchangeCharisolIdToken(base: string, idToken: string): Promise<{ token: string; email?: string; name?: string }> {
  let res: Response;
  try {
    res = await fetch(`${base}/auth/charisol-id-token`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ idToken }) });
  } catch {
    throw new StrataError("Couldn't reach Strata. Check your connection and try again.", "network");
  }
  const body = (await res.json().catch(() => ({}))) as { data?: { token?: unknown; user?: { email?: string; firstName?: string; lastName?: string; name?: string } } };
  if (res.ok && typeof body.data?.token === "string") {
    const u = body.data.user ?? {};
    return { token: body.data.token, email: u.email, name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.name };
  }
  if (res.status === 403) throw new StrataError("Your Strata account is suspended. Contact Charisol support to get it back.", "forbidden", 403);
  if (res.status === 401) throw new StrataError("Strata didn't accept your Charisol sign-in. Try connecting again.", "invalid", 401);
  throw new StrataError("Strata isn't available right now. Please try again in a few minutes.", "server", res.status);
}

/**
 * Signs in to Strata with an email and password (Strata's own POST /auth/login) and returns the session. The password goes
 * straight through and is never stored or logged. Strata's messages are already plain language, so they are passed on.
 */
export async function loginToStrataWithPassword(base: string, email: string, password: string): Promise<{ token: string; email?: string; name?: string }> {
  let res: Response;
  try {
    res = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ email, password }) });
  } catch {
    throw new StrataError("Couldn't reach Strata. Check your connection and try again.", "network");
  }
  const body = (await res.json().catch(() => ({}))) as { message?: string; data?: { token?: unknown; user?: { email?: string; firstName?: string; lastName?: string; name?: string } } };
  if (res.ok && typeof body.data?.token === "string") {
    const u = body.data.user ?? {};
    return { token: body.data.token, email: u.email ?? email, name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.name };
  }
  if (res.status === 429) throw new StrataError("Too many sign-in attempts. Wait a few minutes and try again.", "invalid", 429);
  if (res.status === 403) throw new StrataError(body.message || "That Strata account can't sign in right now. Contact Charisol support if this keeps happening.", "forbidden", 403);
  if (res.status === 401 || res.status === 400) throw new StrataError(body.message || "That email and password don't match a Strata account. Check them and try again.", "invalid", 401);
  throw new StrataError("Strata isn't available right now. Please try again in a few minutes.", "server", res.status);
}
