import { createHash, randomBytes } from "node:crypto";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { decryptAppSecret } from "@/lib/crypto";
import type { AppContext } from "@/lib/appRuntime/context";
import * as store from "./store";
import { AuthError, safeRedirect, type RequestMeta, type SignedIn } from "./service";

// "Sign in with Google" for apps built on Plexo.
//
// Works with zero setup through Charisol auth — the same Cognito user pool (Google enabled)
// Plexo itself signs in with. The visitor goes straight to Google via Cognito's hosted UI
// (identity_provider=Google), and Cognito redirects back to one fixed Plexo URL
// (/api/app-oauth/google/callback on the dashboard), which signs them in to the app's own
// database and hands the browser back to the app's host with a one-time code; the session
// cookie is then set there, first-party. An owner can instead add their own Google OAuth
// client, and Google then redirects straight back to the app.
//
// Configuration: APP_SIGNIN_COGNITO_CLIENT_ID / _USER_POOL_ID / _DOMAIN, written to SSM by
// cdk/lib/app-data-stack.ts — a separate, federated-only "app visitors" pool (app visitors
// are not Charisol accounts) with a public PKCE client and the callback above registered.
// Without _USER_POOL_ID / _DOMAIN it falls back to the Charisol pool.

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

type Client =
  | { mode: "own"; id: string; secret: string; redirectUri: string }
  | { mode: "platform"; id: string; domain: string; userPoolId: string; redirectUri: string };

function platformCallbackUrl(): string {
  return `${new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").origin}/api/app-oauth/google/callback`;
}

function clientFor(ctx: AppContext): Client {
  const s = ctx.settings;
  if (s.googleClientId && s.googleClientSecretCiphertext) {
    return { mode: "own", id: s.googleClientId, secret: decryptAppSecret(s.googleClientSecretCiphertext), redirectUri: `${ctx.origin}/__plexo/api/auth/oauth/google/callback` };
  }
  const id = process.env.APP_SIGNIN_COGNITO_CLIENT_ID;
  const domain = (process.env.APP_SIGNIN_COGNITO_DOMAIN || process.env.NEXT_PUBLIC_CHARISOL_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const userPoolId = process.env.APP_SIGNIN_COGNITO_USER_POOL_ID || process.env.CHARISOL_USER_POOL_ID || "";
  if (!id || !domain || !userPoolId) throw new AuthError("Google sign-in isn't available yet. The app's owner can add their own Google client in Plexo.", 503, "provider_unavailable");
  return { mode: "platform", id, domain, userPoolId, redirectUri: platformCallbackUrl() };
}

const b64url = (b: Buffer) => b.toString("base64url");

/** Where to send the browser to start signing in with Google. */
export async function startGoogleSignIn(ctx: AppContext, redirectTo: unknown): Promise<string> {
  if (!ctx.settings.authGoogle) throw new AuthError("Google sign-in isn't enabled for this app.", 403, "provider_disabled");
  const client = clientFor(ctx);
  const verifier = b64url(randomBytes(32));
  const token = await store.issueToken(ctx, "oauth_state", { data: { redirectTo: safeRedirect(ctx, redirectTo), verifier, mode: client.mode, host: ctx.host } });
  // The platform callback serves every app, so the state says which app (and environment)
  // this is; the random part is what proves it.
  const state = `${ctx.templateId}.${ctx.env}.${token}`;
  const url = new URL(client.mode === "own" ? GOOGLE_AUTH : `https://${client.domain}/oauth2/authorize`);
  url.searchParams.set("client_id", client.id);
  url.searchParams.set("redirect_uri", client.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", b64url(createHash("sha256").update(verifier).digest()));
  url.searchParams.set("code_challenge_method", "S256");
  if (client.mode === "own") url.searchParams.set("prompt", "select_account");
  // Straight to Google — no Charisol sign-in page in between.
  else url.searchParams.set("identity_provider", "Google");
  return url.toString();
}

export function parseState(state: unknown): { templateId: string; env: "dev" | "live"; token: string } | null {
  if (typeof state !== "string") return null;
  const m = state.match(/^([0-9a-f-]{36})\.(dev|live)\.([A-Za-z0-9_-]{20,200})$/);
  return m ? { templateId: m[1], env: m[2] as "dev" | "live", token: m[3] } : null;
}

type GoogleProfile = { sub: string; email: string; name?: string; picture?: string };

const verifiers = new Map<string, ReturnType<typeof CognitoJwtVerifier.create>>();

async function googleProfile(client: Client, code: string, verifier: string): Promise<GoogleProfile> {
  if (client.mode === "own") {
    const tokenRes = await fetch(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: client.id, client_secret: client.secret, redirect_uri: client.redirectUri, grant_type: "authorization_code", code_verifier: verifier }),
    });
    const tokens = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !tokens?.access_token) throw new AuthError("Google sign-in didn't complete. Please try again.", 400, "oauth_failed");
    const profileRes = await fetch(GOOGLE_USERINFO, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    const profile = await profileRes.json().catch(() => null);
    if (!profileRes.ok || !profile?.sub || !profile?.email) throw new AuthError("Google didn't share an email address.", 400, "oauth_failed");
    if (profile.email_verified !== true) throw new AuthError("Your Google email address isn't verified.", 400, "oauth_unverified");
    return profile;
  }

  // Charisol (Cognito): exchange the code (public PKCE client, no secret), then verify the ID
  // token's signature, issuer, audience and expiry before trusting anything in it.
  const tokenRes = await fetch(`https://${client.domain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.id, code, redirect_uri: client.redirectUri, code_verifier: verifier }),
  });
  const tokens = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok || typeof tokens?.id_token !== "string") throw new AuthError("Google sign-in didn't complete. Please try again.", 400, "oauth_failed");
  const key = `${client.userPoolId}:${client.id}`;
  let jwt = verifiers.get(key);
  if (!jwt) {
    jwt = CognitoJwtVerifier.create({ userPoolId: client.userPoolId, tokenUse: "id", clientId: client.id });
    verifiers.set(key, jwt);
  }
  const claims = (await jwt.verify(tokens.id_token).catch(() => {
    throw new AuthError("Google sign-in couldn't be verified. Please try again.", 400, "oauth_failed");
  })) as Record<string, any>;
  const email = typeof claims.email === "string" ? claims.email : "";
  // Federated sign-ins carry the Google identity; Google only hands out verified addresses.
  // A Cognito account signing in any other way must have a verified email itself.
  const google = Array.isArray(claims.identities) ? claims.identities.find((i: any) => String(i?.providerName).toLowerCase() === "google") : null;
  const verified = !!google || claims.email_verified === true || claims.email_verified === "true";
  if (!email) throw new AuthError("Google didn't share an email address.", 400, "oauth_failed");
  if (!verified) throw new AuthError("Your email address isn't verified.", 400, "oauth_unverified");
  // Keyed by the Google account itself (not the Cognito id), so the same person stays the same
  // account if the owner later switches to their own Google client.
  return { sub: google?.userId ? String(google.userId) : String(claims.sub), email, name: claims.name, picture: claims.picture };
}

/** Finds or creates the visitor's account for a Google profile. An existing account with the
 * same (Google-verified) email is linked rather than duplicated. */
async function accountFor(ctx: AppContext, profile: GoogleProfile): Promise<store.AppUserRow> {
  let user = await store.findUserByIdentity(ctx, "google", profile.sub);
  if (!user) {
    const email = profile.email.toLowerCase();
    user = await store.findUserByEmail(ctx, email);
    if (!user) {
      if (!ctx.settings.allowSignups) throw new AuthError("Sign-ups are closed for this app. Ask its owner for an invitation.", 403, "signups_disabled");
      user = await store.createUser(ctx, { email, confirmed: true, metadata: { name: profile.name, avatar_url: profile.picture } }) ?? (await store.findUserByEmail(ctx, email));
    }
    if (!user) throw new AuthError("Couldn't create your account. Please try again.", 500);
    await store.linkIdentity(ctx, user.id, "google", profile.sub, email, { name: profile.name, picture: profile.picture });
  }
  if (user.disabled_at) throw new AuthError("This account has been disabled.", 403, "user_disabled");
  return (await store.updateUser(ctx, user.id, { confirmEmail: true })) ?? user;
}

export type OAuthState = { redirectTo: string; verifier: string; mode: "own" | "platform"; host: string };

/** Uses the one-time state from Google's redirect. Null if expired, reused or forged. */
export async function consumeOAuthState(ctx: AppContext, token: string): Promise<OAuthState | null> {
  const st = await store.consumeToken(ctx, "oauth_state", token);
  if (!st) return null;
  return { redirectTo: String(st.data.redirectTo ?? "/"), verifier: String(st.data.verifier ?? ""), mode: st.data.mode === "platform" ? "platform" : "own", host: String(st.data.host ?? "") };
}

/** Google's redirect back, for both modes. `ctx` must be the app on the host the flow
 * started from (checked against the state). Returns where to send the browser next: the
 * app, signed in (own client), or the app's /oauth/complete hop (platform client). */
export async function finishGoogleSignIn(
  ctx: AppContext,
  input: { code?: unknown; state: OAuthState; via: "app" | "platform" },
  meta: RequestMeta,
): Promise<{ redirectTo: string; signedIn?: SignedIn }> {
  const redirectTo = safeRedirect(ctx, input.state.redirectTo);
  if (input.state.host !== ctx.host || (input.via === "platform") !== (input.state.mode === "platform")) {
    throw new AuthError("That sign-in attempt doesn't match this app.", 400, "invalid_state");
  }
  // No code: the visitor cancelled on Google's screen — just go back to the app.
  if (typeof input.code !== "string") return { redirectTo };
  const user = await accountFor(ctx, await googleProfile(clientFor(ctx), input.code, input.state.verifier));
  if (input.via === "app") {
    const sessionToken = await store.createSession(ctx, user.id, meta);
    return { redirectTo, signedIn: { user: store.toPublicUser(user), sessionToken } };
  }
  const handoff = await store.issueToken(ctx, "oauth_complete", { userId: user.id, data: { redirectTo } });
  return { redirectTo: `${ctx.origin}/__plexo/api/auth/oauth/complete?token=${handoff}` };
}

/** Last hop of the platform flow, on the app's own host: sets the session cookie there. */
export async function completeHandoff(ctx: AppContext, token: string, meta: RequestMeta): Promise<{ redirectTo: string; signedIn?: SignedIn }> {
  const used = await store.consumeToken(ctx, "oauth_complete", token);
  if (!used?.userId) return { redirectTo: safeRedirect(ctx, "/") };
  const user = await store.findUserById(ctx, used.userId);
  if (!user || user.disabled_at) return { redirectTo: safeRedirect(ctx, used.data.redirectTo) };
  const sessionToken = await store.createSession(ctx, user.id, meta);
  return { redirectTo: safeRedirect(ctx, used.data.redirectTo), signedIn: { user: store.toPublicUser(user), sessionToken } };
}
