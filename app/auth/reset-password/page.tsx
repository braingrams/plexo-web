"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

import { authClient } from "@/lib/auth-client";

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const token = params.get("token");
    if (!token) {
      setError("Missing reset token in URL.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const result = await (authClient as any).resetPassword({
        token,
        newPassword: password,
      });

      if (result?.error) {
        setError(result.error.message ?? "Unable to reset password.");
        return;
      }

      router.push("/auth/login?passwordReset=1");
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to reset password.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-card">
      <h1 className="auth-title">Reset Password</h1>
      <p className="auth-subtitle">Create a fresh credential for your account.</p>

      <form onSubmit={onSubmit}>
        <label className="auth-field">
          <span className="auth-label">New Password</span>
          <input
            className="auth-input"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <label className="auth-field">
          <span className="auth-label">Confirm New Password</span>
          <input
            className="auth-input"
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </label>

        {error ? <p className="auth-error">{error}</p> : null}

        <button className="auth-button" type="submit" disabled={loading}>
          {loading ? <span className="auth-spinner" aria-hidden="true" /> : null}
          {loading ? "Updating..." : "Reset password"}
        </button>
      </form>

      <p className="auth-meta">
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
              Loading token...
            </button>
          </section>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
