"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

import { authClient } from "@/lib/auth-client";

type Plan = "FREE" | "PRO" | "ULTRA";

const PLAN_COPY: Record<Plan, { label: string; price: string }> = {
  FREE: { label: "Free", price: "$0/mo" },
  PRO: { label: "Pro", price: "$19/mo" },
  ULTRA: { label: "Ultra", price: "$49/mo" },
};

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

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPlan = searchParams.get("plan")?.toUpperCase();
  const plan: Plan = requestedPlan === "PRO" || requestedPlan === "ULTRA" ? requestedPlan : "FREE";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const result = await (authClient as any).signUp.email({
        name: name.trim() || email.split("@")[0] || "Plexo User",
        email,
        password,
        callbackURL: "/dashboard",
        // Persisted atomically at row-creation time via server/auth.ts's databaseHooks —
        // signUp.email() has no session yet to attach a follow-up authenticated write to
        // (requireEmailVerification skips auto-sign-in), so this can't be a separate call.
        ...(plan !== "FREE" ? { pendingPlan: plan } : {}),
      });

      if (result?.error) {
        setError(result.error.message ?? "Registration failed.");
        return;
      }

      router.push(`/auth/confirm?email=${encodeURIComponent(email)}`);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Registration failed.";
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

        <h1 className="auth-title">Create your account</h1>
        <p className="auth-subtitle">Start building beautiful templates today.</p>

        <div style={{ display: "flex", gap: 6, marginBottom: "1.25rem" }}>
          {(Object.keys(PLAN_COPY) as Plan[]).map((p) => (
            <Link
              key={p}
              href={`/auth/register?plan=${p}`}
              style={{
                flex: 1, textAlign: "center", padding: "0.5rem 0.4rem", borderRadius: 9,
                fontSize: "0.78rem", fontWeight: 700, textDecoration: "none",
                border: plan === p ? "1px solid var(--brand)" : "1px solid rgba(255,255,255,0.1)",
                background: plan === p ? "var(--brand-subtle)" : "transparent",
                color: plan === p ? "var(--brand)" : "rgba(240,242,255,0.55)",
              }}
            >
              {PLAN_COPY[p].label}
              <span style={{ display: "block", fontSize: "0.68rem", fontWeight: 500, opacity: 0.75 }}>
                {PLAN_COPY[p].price}
              </span>
            </Link>
          ))}
        </div>

        {plan === "FREE" ? (
          <p className="auth-meta" style={{ marginTop: -8, marginBottom: "1rem", color: "#34d399" }}>
            No credit card required.
          </p>
        ) : (
          <p className="auth-meta" style={{ marginTop: -8, marginBottom: "1rem" }}>
            You&apos;ll create your account first, then complete payment for {PLAN_COPY[plan].label} on the next step.
          </p>
        )}

        <form onSubmit={onSubmit} noValidate>
          {/* Name */}
          <label className="auth-field">
            <span className="auth-label">Display Name</span>
            <input
              id="register-name"
              className="auth-input"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Johnson"
            />
          </label>

          {/* Email */}
          <label className="auth-field">
            <span className="auth-label">Email address</span>
            <input
              id="register-email"
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
            <span className="auth-label">Password</span>
            <div className="auth-input-wrap">
              <input
                id="register-password"
                className="auth-input auth-input-pr"
                type={showPw ? "text" : "password"}
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
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

          {/* Confirm Password */}
          <div className="auth-field">
            <span className="auth-label">Confirm Password</span>
            <div className="auth-input-wrap">
              <input
                id="register-confirm-password"
                className="auth-input auth-input-pr"
                type={showConfirmPw ? "text" : "password"}
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Retype your password"
              />
              <button
                type="button"
                className="auth-eye-btn"
                aria-label={showConfirmPw ? "Hide confirm password" : "Show confirm password"}
                onClick={() => setShowConfirmPw((v) => !v)}
              >
                <EyeIcon visible={showConfirmPw} />
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

          <button className="auth-button" id="register-submit" type="submit" disabled={loading}>
            {loading ? <span className="auth-spinner" aria-hidden="true" /> : null}
            {loading ? "Creating account…" : "Create Account"}
          </button>
        </form>

        <p className="auth-meta">
          Already have an account?{" "}
          <Link href="/auth/login" className="auth-link">
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
