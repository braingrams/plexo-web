"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

import { authClient } from "@/lib/auth-client";

function EyeIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

function PlexoLogoMark() {
  return (
    <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", display: "grid", placeItems: "center", boxShadow: "0 0 14px rgba(139,92,246,0.4)", flexShrink: 0 }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="white" opacity="0.95" />
        <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const redirectTo = params.get("redirectTo") ?? "/dashboard/templates";

    try {
      const result = await (authClient as any).signIn.email({
        email,
        password,
        callbackURL: redirectTo,
      });

      const status = result?.error?.status;
      if (status === 403) {
        setError("This account is not verified yet. Check your email for the verification link.");
        return;
      }

      if (result?.error) {
        setError(result.error.message ?? "Invalid credentials.");
        return;
      }

      router.push(redirectTo);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Invalid credentials.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-card">
      {/* Logo */}
      <Link href="/" className="auth-logo">
        <PlexoLogoMark />
        <span className="auth-logo-text">Plexo</span>
      </Link>

      <h1 className="auth-title">Welcome back</h1>
      <p className="auth-subtitle">Sign in to your Plexo workspace.</p>

      <form onSubmit={onSubmit} noValidate>
        {/* Email */}
        <label className="auth-field">
          <span className="auth-label">Email address</span>
          <input
            id="login-email"
            className="auth-input"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </label>

        {/* Password */}
        <div className="auth-field">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="auth-label">Password</span>
            <Link href="/auth/forgot-password" className="auth-link" style={{ fontSize: "0.78rem" }}>
              Forgot password?
            </Link>
          </div>
          <div className="auth-input-wrap">
            <input
              id="login-password"
              className="auth-input auth-input-pr"
              type={showPw ? "text" : "password"}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
            />
            <button
              type="button"
              className="auth-eye-btn"
              aria-label={showPw ? "Hide password" : "Show password"}
              onClick={() => setShowPw((v) => !v)}
            >
              <EyeIcon visible={showPw} />
            </button>
          </div>
        </div>

        {error ? (
          <p className="auth-error" role="alert">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </p>
        ) : null}

        <button className="auth-button" id="login-submit" type="submit" disabled={loading}>
          {loading ? <span className="auth-spinner" aria-hidden="true" /> : null}
          {loading ? "Signing in…" : "Sign In"}
        </button>
      </form>

      <p className="auth-meta">
        Don&apos;t have an account?{" "}
        <Link href="/auth/register" className="auth-link">
          Create one free
        </Link>
      </p>
    </section>
  );
}

export default function LoginPage() {
  return (
    <main className="auth-shell">
      <Suspense
        fallback={
          <section className="auth-card">
            <h1 className="auth-title">Welcome back</h1>
            <button className="auth-button" type="button" disabled>
              <span className="auth-spinner" aria-hidden="true" />
              Loading…
            </button>
          </section>
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
