"use client";

import { trackEvent } from "@/lib/analytics";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { initialAuthError } from "@/lib/charisolAuth";
import { AuthShell } from "@/app/auth/_kit/AuthShell";
import { Alert, Button, Divider, PageHead } from "@/app/auth/_kit/ui";
import { PasswordField, TextField } from "@/app/auth/_kit/fields";
import { GoogleAuthButton } from "@/app/auth/GoogleAuthButton";
import { SigningIn } from "@/app/auth/_kit/SigningIn";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Arriving from the reset-password page: their email is pre-filled and a banner confirms it.
  const passwordReset = params.get("passwordReset") === "1";
  const [email, setEmail] = useState(() => params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  // Signed in, on the way to the dashboard: its first render takes a moment, so the page shows the dashboard's own outline instead of freezing.
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A failed Charisol/Google sign-in routes back here with ?error=... (see
  // app/auth/charisol/callback/page.tsx). The Charisol SDK removes that param from the address bar as soon
  // as it loads, so the message is read from what it captured (initialAuthError) as well as the URL. It's
  // set after the page has loaded so the server and browser renders agree. A raw error code (one word,
  // straight from Google) becomes a plain sentence.
  useEffect(() => {
    const raw = params.get("error") ?? initialAuthError;
    if (!raw) return;
    setError(/\s/.test(raw) ? raw : "Google sign-in didn’t complete. Please try again.");
    if (!params.get("error")) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setLoading(true);

    // Only ever a path on this site (never another address someone put in the link).
    const wanted = params.get("redirectTo") ?? "/dashboard";
    const redirectTo = wanted.startsWith("/") && !wanted.startsWith("//") ? wanted : "/dashboard";

    try {
      const result = await authClient.signIn.email({
        email,
        password,
        callbackURL: redirectTo,
      });

      // A Google-only account has no password. Say so and point at the Google button —
      // never redirect on the owner's behalf from the email form.
      if (result?.error?.code === "google_account_only") {
        setError("That password didn’t work. This account was set up with Google — use “Continue with Google” above, or choose “Forgot password” to set a password.");
        return;
      }

      // Charisol Auth needs this account to pick a new password first (usually an older
      // password that's shorter than today's rules, moved across on this sign-in). A code
      // has already been emailed — go straight to entering it.
      if (result?.error?.code === "password_reset_required") {
        router.push(`/auth/reset-password?mode=code&reason=security&email=${encodeURIComponent(email.trim().toLowerCase())}`);
        return;
      }

      const status = result?.error?.status;
      if (status === 403) {
        setError("This account is not verified yet. Check your email for the verification link.");
        return;
      }

      if (result?.error) {
        setError(result.error.message ?? "Invalid credentials.");
        return;
      }

      trackEvent({ event: "login", method: "email" });
      if (redirectTo.startsWith("/dashboard")) setRedirecting(true);
      // A full page load, not a client-side push: the sign-in cookie is fresh, and a client-side push can reuse a copy of the
      // destination fetched while signed out (which just bounces back here) and leave the person on this screen for good.
      window.location.assign(redirectTo);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Invalid credentials.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  if (redirecting) {
    // Covers the whole screen (the sign-in layout's own panels included) until the dashboard replaces it.
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 100, overflow: "auto" }}>
        <SigningIn />
      </div>
    );
  }

  return (
    <>
      <PageHead title="Welcome back">Sign in to your account.</PageHead>

      <GoogleAuthButton callbackURL={params.get("redirectTo") ?? "/dashboard"} />
      <Divider>or</Divider>

      <form onSubmit={onSubmit} noValidate className="ax-stack" aria-describedby={error ? "login-error" : undefined}>
        {passwordReset && !error && <Alert tone="success" title="Password updated">Sign in with your new password.</Alert>}
        {error && <div id="login-error"><Alert tone="error">{error}</Alert></div>}

        <TextField
          label="Email address"
          id="login-email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <PasswordField
          id="login-password"
          label="Password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          labelAction={<Link href="/auth/forgot-password" className="ax-link" style={{ fontSize: 13 }}>Forgot password?</Link>}
        />

        <Button id="login-submit" type="submit" loading={loading}>{loading ? "Signing in…" : "Sign in"}</Button>
      </form>

      <p className="ax-foot">
        New to Plexo?{" "}
        <Link href="/auth/register" className="ax-link">Create a free account</Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
