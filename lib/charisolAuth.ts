import { CharisolAuth } from "@charisol/auth-sdk-web";

// Called at module scope, not inside a component's useEffect — per the SDK's own
// onboarding guide, a child component's effect (e.g. this callback page's getSession()
// call) can fire before a parent provider's effect on initial mount, so init()-in-useEffect
// races getSession() and throws "CharisolAuth.init() must be called before use" even
// though sign-in actually succeeded. Module scope runs once on import, before any effect.
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
    showRedirectNotice: true,
  });
}

export { CharisolAuth };

// Cognito's redirect_uri must match what's registered for this app client verbatim, so
// there's no room to carry a per-attempt post-login destination through it. Callers stash
// the caller's intended destination here before redirecting; the callback page reads it
// back once the sign-in round-trip completes.
export const POST_LOGIN_REDIRECT_KEY = "plexo_post_login_redirect";

// Shared by GoogleAuthButton.tsx and app/auth/login/page.tsx's "this account uses Google
// sign-in" prompt — one place for the stash-then-redirect sequence so both stay in sync.
export async function triggerGoogleSignIn(callbackURL: string): Promise<void> {
  window.sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, callbackURL);
  await CharisolAuth.signIn();
}
