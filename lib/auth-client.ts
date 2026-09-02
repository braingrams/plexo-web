"use client";

import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from "next-auth/react";

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
        const unverified = (result as { code?: string }).code === "unverified_email";
        const status = unverified ? 403 : 401;
        const message = unverified
          ? "This account is not verified yet. Check your email for the verification link."
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
  },
  signUp: {
    email(input: { name: string; email: string; password: string; callbackURL?: string; pendingPlan?: string }): Promise<AuthResult<{ id: string; email: string }>> {
      return postJson("/api/auth/register", input);
    },
  },
  async signOut(): Promise<void> {
    await nextAuthSignOut();
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
