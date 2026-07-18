"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";

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

      setSuccess("If this email exists, a recovery link has been sent.");
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
        <h1 className="auth-title">Recover Password</h1>
        <p className="auth-subtitle">Send a secure password reset link to your inbox.</p>

        <form onSubmit={onSubmit}>
          <label className="auth-field">
            <span className="auth-label">Email</span>
            <input
              className="auth-input"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
            />
          </label>

          {error ? <p className="auth-error">{error}</p> : null}
          {success ? <p className="auth-success">{success}</p> : null}

          <button className="auth-button" type="submit" disabled={loading}>
            {loading ? <span className="auth-spinner" aria-hidden="true" /> : null}
            {loading ? "Sending..." : "Send reset link"}
          </button>
        </form>

        <p className="auth-meta">
          Remembered it?{" "}
          <Link href="/auth/login" className="auth-link">
            Return to login
          </Link>
        </p>
      </section>
    </main>
  );
}
