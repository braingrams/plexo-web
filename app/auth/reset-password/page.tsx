"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { PASSWORD_MIN_LENGTH, PASSWORD_RULES_TEXT, passwordProblem } from "@/lib/passwordPolicy";

// Two ways in:
//  - ?token=…&email=…  — the emailed reset LINK (accounts whose password Plexo still holds);
//  - ?mode=code&email=… — a 6-digit CODE emailed by Charisol Auth (accounts whose password now
//    lives in Charisol), optionally with reason=security when sign-in itself required a new
//    password (a moved-over password that doesn't meet the password rules).
function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const token = params.get("token");
  const codeMode = params.get("mode") === "code";
  const securityReset = params.get("reason") === "security";

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!email || (!codeMode && !token)) {
      setError("This reset link is incomplete. Request a new one from the Forgot password page.");
      return;
    }
    if (codeMode && !/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from the email we sent you.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    const problem = passwordProblem(password, email);
    if (problem) {
      setError(problem);
      return;
    }

    setLoading(true);
    try {
      const result = await authClient.resetPassword(
        codeMode ? { email, code: code.trim(), newPassword: password } : { token: token!, email, newPassword: password },
      );
      if (result?.error) {
        setError(result.error.message ?? "Unable to reset password.");
        return;
      }
      router.push(`/auth/login?passwordReset=1&email=${encodeURIComponent(email)}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to reset password.");
    } finally {
      setLoading(false);
    }
  }

  async function resendCode(): Promise<void> {
    setError(null);
    setNotice(null);
    setResending(true);
    try {
      const result = await authClient.forgetPassword({ email });
      if (result?.error) setError(result.error.message ?? "Couldn't send a new code.");
      else setNotice("We've sent a new code. It can take a minute to arrive — check your spam folder too.");
    } finally {
      setResending(false);
    }
  }

  return (
    <section className="auth-card">
      <h1 className="auth-title">{securityReset ? "Choose a new password" : "Reset Password"}</h1>
      <p className="auth-subtitle">
        {securityReset
          ? "For your security, your account needs a new password before you can sign in. We've emailed you a 6-digit code."
          : codeMode
            ? `Enter the 6-digit code we emailed to ${email || "you"} and choose a new password.`
            : "Create a fresh credential for your account."}
      </p>

      <form onSubmit={onSubmit}>
        {codeMode ? (
          <label className="auth-field">
            <span className="auth-label">Code from your email</span>
            <input
              className="auth-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            />
          </label>
        ) : null}

        <label className="auth-field">
          <span className="auth-label">New Password</span>
          <input
            className="auth-input"
            type="password"
            required
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span className="auth-meta" style={{ textAlign: "left", marginTop: 4 }}>{PASSWORD_RULES_TEXT}</span>
        </label>

        <label className="auth-field">
          <span className="auth-label">Confirm New Password</span>
          <input
            className="auth-input"
            type="password"
            required
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </label>

        {notice ? <p className="auth-meta">{notice}</p> : null}
        {error ? <p className="auth-error">{error}</p> : null}

        <button className="auth-button" type="submit" disabled={loading}>
          {loading ? <span className="auth-spinner" aria-hidden="true" /> : null}
          {loading ? "Updating..." : "Save new password"}
        </button>
      </form>

      <p className="auth-meta">
        {codeMode && email ? (
          <>
            Didn&apos;t get it?{" "}
            <button type="button" className="auth-link" onClick={() => void resendCode()} disabled={resending}>
              {resending ? "Sending…" : "Send a new code"}
            </button>
            {" · "}
          </>
        ) : null}
        <Link href="/auth/login" className="auth-link">
          Back to login
        </Link>
      </p>
    </section>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="auth-shell">
      <Suspense
        fallback={
          <section className="auth-card">
            <h1 className="auth-title">Reset Password</h1>
            <button className="auth-button" type="button" disabled>
              <span className="auth-spinner" aria-hidden="true" />
              Loading…
            </button>
          </section>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
