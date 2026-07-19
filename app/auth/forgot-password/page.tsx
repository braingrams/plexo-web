"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";

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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    const redirectTo = `${window.location.origin}/auth/reset-password`;

    try {
      const result = await (authClient as any).forgetPassword({
        email,
        redirectTo,
      });

      if (result?.error) {
        setError(result.error.message ?? "Unable to request password reset.");
        return;
      }

      setSuccess("If this email exists, a recovery link has been sent. Check your inbox.");
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Unable to request password reset.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        {/* Logo */}
        <Link href="/" className="auth-logo">
          <PlexoLogoMark />
          <span className="auth-logo-text">Plexo</span>
        </Link>

        <h1 className="auth-title">Reset your password</h1>
        <p className="auth-subtitle">
          Enter your email and we&apos;ll send a secure recovery link.
        </p>

        {success ? (
          <div style={{
            marginTop: "1.5rem",
            padding: "1.25rem",
            borderRadius: 12,
            background: "rgba(52,211,153,0.08)",
            border: "1px solid rgba(52,211,153,0.25)",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <p style={{ fontSize: "0.875rem", color: "#34d399", lineHeight: 1.55 }}>{success}</p>
            </div>
            <Link
              href="/auth/login"
              className="auth-link"
              style={{ display: "block", marginTop: "0.75rem", fontSize: "0.82rem", textAlign: "center" }}
            >
              Return to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <label className="auth-field">
              <span className="auth-label">Email address</span>
              <input
                id="forgot-email"
                className="auth-input"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </label>

            {error ? (
              <p className="auth-error" role="alert">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </p>
            ) : null}

            <button className="auth-button" id="forgot-submit" type="submit" disabled={loading}>
              {loading ? <span className="auth-spinner" aria-hidden="true" /> : null}
              {loading ? "Sending link…" : "Send Reset Link"}
            </button>
          </form>
        )}

        {!success && (
          <p className="auth-meta">
            Remember your password?{" "}
            <Link href="/auth/login" className="auth-link">
              Sign in
            </Link>
          </p>
        )}
      </section>
    </main>
  );
}
