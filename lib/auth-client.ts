"use client";

import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from "next-auth/react";
import { CharisolAuth } from "@/lib/charisolAuth";

// Auth.js-backed replacement for better-auth's client SDK (createAuthClient). Preserves
// the exact call shape every existing caller already used (app/auth/{login,register,
// forgot-password,reset-password}/page.tsx, GoogleAuthButton.tsx, both dashboard shells,
// TeamHeaderControls.tsx, choose-org-client.tsx) so none of those 9 files needed to change
// their own logic — only this shim's internals moved from better-auth's REST protocol to
// Auth.js's (next-auth/react's signIn/signOut) + this migration's own /api/auth/* and
// /api/org/* routes for everything better-auth used to handle server-side that Auth.js's
// Credentials provider doesn't (signup, email verification, password reset, org listing).
//
// Error shape: better-auth's client returned `{error: {status, message}} | {data}`;
// next-auth/react's signIn() returns `{error?: string, status, ok, url}` instead (a flat
// string error code, not an object). Every wrapper below normalizes back to the
// `{error: {status, message}}` shape so existing callers' `result?.error?.status`/
// `result.error.message` checks keep working unchanged.

type AuthResult<T = Record<string, unknown>> = { data: T; error?: undefined } | { data?: undefined; error: { status: number; message: string } };

async function postJson<T>(url: string, body: unknown): Promise<AuthResult<T>> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    return { error: { status: res.status, message: json?.error?.message ?? "Something went wrong." } };
  }
  return { data: json.data as T };
}

export const authClient = {
  signIn: {
    async email({ email, password }: { email: string; password: string; callbackURL?: string }): Promise<AuthResult> {
      const result = await nextAuthSignIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        // next-auth/react's signIn() splits a thrown CredentialsSignin into two fields:
        // `error` is always the generic "CredentialsSignin" type string, `code` carries
        // the specific reason (server/authDynamo.ts's UnverifiedEmailError sets
        // code: "unverified_email"; the default, unauthenticated case is "credentials").
        // Only `code` is useful for branching — mapped to 403 to match the UX every
        // caller already checks for (app/auth/login/page.tsx's `status === 403` branch).
        const code = (result as { code?: string }).code;
        const unverified = code === "unverified_email";
        const tooManyAttempts = code === "too_many_attempts";
        const status = unverified ? 403 : tooManyAttempts ? 429 : 401;
        const message = unverified
          ? "This account is not verified yet. Check your email for the verification link."
          : tooManyAttempts
            ? "Too many login attempts for this account. Please wait 15 minutes and try again."
            : "Invalid credentials.";
        return { error: { status, message } };
      }
      return { data: {} };
    },
    async social({ provider, callbackURL }: { provider: string; callbackURL: string }): Promise<void> {
      // Real full-page redirect to the provider, same as better-auth's own social sign-in —
      // deliberately not `redirect: false` here, there's no local error state to show for
      // an OAuth handoff.
      await nextAuthSignIn(provider, { callbackUrl: callbackURL });
    },
    // Bridges an already-verified Charisol/Cognito ID token (app/auth/charisol/callback)
    // into a Plexo session — server/authDynamo.ts's "charisol" Credentials provider
    // re-verifies it (aws-jwt-verify) before trusting any claim, this call is not itself
    // a trust boundary. `redirect: false` since the callback page drives its own
    // navigation once it knows whether this succeeded.
    async charisol({ idToken }: { idToken: string }): Promise<AuthResult> {
      const result = await nextAuthSignIn("charisol", { idToken, redirect: false });
      if (result?.error) {
        return { error: { status: 401, message: "Could not complete Google sign-in." } };
      }
      return { data: {} };
    },
  },
  signUp: {
    email(input: { name: string; email: string; password: string; callbackURL?: string; pendingPlan?: string }): Promise<AuthResult<{ id: string; email: string }>> {
      return postJson("/api/auth/register", input);
    },
  },
  async signOut(): Promise<void> {
    // redirect:false — we drive the navigation ourselves below instead of letting
    // next-auth/react send the browser straight back to the current page.
    await nextAuthSignOut({ redirect: false });
    // Single logout: also end the shared auth.charisol.io session, not just Plexo's own
    // cookie. This is a hard redirect (see CharisolAuthClient.signOut()) to Cognito's
    // /logout, which clears its hosted-UI session cookie and then lands the browser on
    // lib/charisolAuth.ts's logoutRedirectUri (/auth/login) — without it, Cognito's session
    // would outlive Plexo's and the user would land back on Maildrip/etc. still signed in.
    await CharisolAuth.signOut();
  },
  forgetPassword(input: { email: string; redirectTo?: string }): Promise<AuthResult<{ ok: boolean }>> {
    return postJson("/api/auth/forgot-password", input);
  },
  resetPassword(input: { token: string; email: string; newPassword: string }): Promise<AuthResult<{ ok: boolean }>> {
    return postJson("/api/auth/reset-password", input);
  },
  organization: {
    async list(): Promise<AuthResult<{ id: string; name: string }[]>> {
      const res = await fetch("/api/org");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: { status: res.status, message: json?.error ?? "Failed to list organizations." } };
      return { data: json.data ?? [] };
    },
    setActive(input: { organizationId: string }): Promise<AuthResult<{ ok: boolean }>> {
      return postJson("/api/org/active", input);
    },
  },
};
