import { CharisolAuth } from "@charisol/auth-sdk-web";
import { clearStrataConnect } from "@/lib/strataConnect";

// Called at module scope, not inside a component's useEffect — per the SDK's own
// onboarding guide, a child component's effect (e.g. this callback page's getSession()
// call) can fire before a parent provider's effect on initial mount, so init()-in-useEffect
// races getSession() and throws "CharisolAuth.init() must be called before use" even
// though sign-in actually succeeded. Module scope runs once on import, before any effect.
/** Cognito's error when it sent the person back without signing in (e.g. "login_required"), captured before the SDK clears it from the URL. */
export const initialAuthError: string | null = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("error") : null;

if (typeof window !== "undefined") {
  CharisolAuth.init({
    clientId: process.env.NEXT_PUBLIC_CHARISOL_CLIENT_ID ?? "",
    domain: process.env.NEXT_PUBLIC_CHARISOL_DOMAIN,
    redirectUri: `${window.location.origin}/auth/charisol/callback`,
    // Signing out of Plexo also ends the shared Cognito session on auth.charisol.io (see
    // lib/auth-client.ts's signOut()), not just Plexo's own cookie — otherwise Cognito's
    // hosted-UI session would outlive Plexo's and the user would land back on Maildrip/etc.
    // still silently signed in. Must be registered as a logout URI for this app client in
    // the Developer Portal, same as redirectUri above is registered as a redirect URI.
    logoutRedirectUri: `${window.location.origin}/auth/login`,
    appName: "Plexo",
    // Next.js's app/icon.tsx conventional route — a real, publicly fetchable 32x32 PNG of
    // the same mark app/plexo-logo.tsx renders as React elsewhere in the app (there's no
    // static logo file to point at directly; this is the one place Plexo's mark already
    // gets rendered to an actual image).
    appLogoUrl: `${window.location.origin}/icon`,
    // "Continue with Google" goes straight to Google (triggerGoogleSignIn) — no notice
    // screen or Charisol page in between.
    showRedirectNotice: false,
  });
}

export { CharisolAuth };

// Cognito's redirect_uri must match what's registered for this app client verbatim, so
// there's no room to carry a per-attempt post-login destination through it. Callers stash
// the caller's intended destination here before redirecting; the callback page reads it
// back once the sign-in round-trip completes.
export const POST_LOGIN_REDIRECT_KEY = "plexo_post_login_redirect";

// The one place that starts a Google sign-in (GoogleAuthButton.tsx): stash where to go
// afterwards, then hand off to Google.
export async function triggerGoogleSignIn(callbackURL: string): Promise<void> {
  window.sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, callbackURL);
  // A normal sign-in is never a "Connect Strata" one, whatever an abandoned popup left behind.
  clearStrataConnect(window.sessionStorage);
  // identity_provider=Google skips the Charisol sign-in page and opens Google's account
  // picker directly ("Google" is the provider's name on the Charisol user pool).
  await CharisolAuth.signIn({ idp: "Google" });
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Asks Charisol to sign the person in only if they already are (`prompt=none`): nothing is shown, and they come straight
 * back to the callback page either with a code or with a "login_required" error. Same flow and storage as the SDK's own
 * signIn(), so the callback page completes it the usual way.
 */
export async function silentCharisolSignIn(): Promise<void> {
  const clientId = process.env.NEXT_PUBLIC_CHARISOL_CLIENT_ID ?? "";
  const domain = process.env.NEXT_PUBLIC_CHARISOL_DOMAIN || "auth.charisol.io";
  const redirectUri = `${window.location.origin}/auth/charisol/callback`;
  const rand = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));
  const codeVerifier = rand(48);
  const state = rand(24);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier))));
  window.sessionStorage.setItem("charisol_auth_pending", JSON.stringify({ state, codeVerifier, redirectUri }));
  const url = new URL(`https://${domain}/oauth2/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "none");
  window.location.assign(url.toString());
}
