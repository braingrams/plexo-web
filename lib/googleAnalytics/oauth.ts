import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Plexo's own Google sign-in for Analytics. Plexo owns the Google Cloud project and OAuth app, so a
 * site owner only clicks "Connect Google Analytics" and signs in. Authorization-code flow with PKCE
 * and a signed `state`; the one-time code verifier travels in a short-lived httpOnly cookie. No token
 * or code is ever logged.
 */

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** Read reports, and create the property + data stream for a site that has none. */
export const GA_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/analytics.readonly", "https://www.googleapis.com/auth/analytics.edit"] as const;

export const OAUTH_COOKIE = "plexo_ga_oauth";
const STATE_TTL_MS = 10 * 60 * 1000;

export function isGoogleAnalyticsConfigured(): boolean {
  return !!(process.env.GOOGLE_ANALYTICS_CLIENT_ID && process.env.GOOGLE_ANALYTICS_CLIENT_SECRET && process.env.GOOGLE_ANALYTICS_TOKEN_ENCRYPTION_SECRET);
}

/** Dev/preview without Google credentials: reports come from sample data and "connecting" is simulated. */
export function isGoogleAnalyticsMock(): boolean {
  return process.env.GOOGLE_ANALYTICS_MOCK === "1" || (!isGoogleAnalyticsConfigured() && process.env.NODE_ENV !== "production");
}

export function redirectUri(): string {
  if (process.env.GOOGLE_ANALYTICS_REDIRECT_URI) return process.env.GOOGLE_ANALYTICS_REDIRECT_URI;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/api/google-analytics/callback`;
}

const b64u = (buf: Buffer) => buf.toString("base64url");

function stateKey(): Buffer {
  const secret = process.env.GOOGLE_ANALYTICS_TOKEN_ENCRYPTION_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "dev-only-state-secret");
  if (!secret) throw new Error("GOOGLE_ANALYTICS_TOKEN_ENCRYPTION_SECRET is not configured.");
  return createHash("sha256").update(`ga-oauth-state:${secret}`).digest();
}

function sign(payload: string): string {
  return b64u(createHmac("sha256", stateKey()).update(payload).digest());
}

export type OAuthState = { siteId: string; userId: string; nonce: string; exp: number };

export function createState(siteId: string, userId: string, now = Date.now()): { state: string; nonce: string } {
  const nonce = b64u(randomBytes(16));
  const payload = b64u(Buffer.from(JSON.stringify({ siteId, userId, nonce, exp: now + STATE_TTL_MS } satisfies OAuthState)));
  return { state: `${payload}.${sign(payload)}`, nonce };
}

/** The state if its signature is genuine and it has not expired; otherwise null. */
export function verifyState(state: string | null | undefined, now = Date.now()): OAuthState | null {
  if (!state) return null;
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (typeof parsed.siteId !== "string" || typeof parsed.userId !== "string" || typeof parsed.nonce !== "string" || typeof parsed.exp !== "number") return null;
    return parsed.exp > now ? parsed : null;
  } catch {
    return null;
  }
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = b64u(randomBytes(48));
  return { verifier, challenge: b64u(createHash("sha256").update(verifier).digest()) };
}

export function buildAuthUrl(input: { state: string; challenge: string; loginHint?: string }): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_ANALYTICS_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GA_SCOPES.join(" "),
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    // offline + consent: Google only returns a refresh token when asked, and only on a fresh consent.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  if (input.loginHint) params.set("login_hint", input.loginHint);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export type TokenResponse = { accessToken: string; refreshToken?: string; scope: string; idToken?: string; expiresIn: number };

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_ANALYTICS_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_ANALYTICS_CLIENT_SECRET ?? "", ...body }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; id_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) {
    // Only Google's error code is surfaced, never the request or any token.
    throw new GoogleAuthError(json.error ?? `token_http_${res.status}`);
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token, scope: json.scope ?? "", idToken: json.id_token, expiresIn: json.expires_in ?? 3600 };
}

export class GoogleAuthError extends Error {
  /** invalid_grant means the owner took the permission back (or it expired): they need to connect again. */
  get needsReconnect(): boolean {
    return this.message === "invalid_grant";
  }
}

export function exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
  return postToken({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri() });
}

export function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return postToken({ grant_type: "refresh_token", refresh_token: refreshToken });
}

/** Best effort: tells Google to forget the grant when the owner disconnects. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(GOOGLE_REVOKE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) });
  } catch {
    // Disconnecting still works on our side.
  }
}

/** The email in a Google id_token. The token came straight from Google over TLS, so it is read, not re-verified. */
export function emailFromIdToken(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string };
    return claims.email;
  } catch {
    return undefined;
  }
}

/** Did the owner tick every permission we need? Google lets people untick on the consent screen. */
export function hasRequiredScopes(granted: string): boolean {
  const set = new Set(granted.split(/\s+/));
  return set.has("https://www.googleapis.com/auth/analytics.readonly") && set.has("https://www.googleapis.com/auth/analytics.edit");
}
