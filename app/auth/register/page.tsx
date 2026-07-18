"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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
        name: email.split("@")[0] || "Plexo User",
        email,
        password,
        callbackURL: "/dashboard/templates",
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
        <h1 className="auth-title">Create Plexo Account</h1>
        <p className="auth-subtitle">Provision your account and verify email to continue.</p>

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

          <label className="auth-field">
            <span className="auth-label">Password</span>
            <input
              className="auth-input"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
            />
          </label>

          <label className="auth-field">
            <span className="auth-label">Confirm Password</span>
            <input
              className="auth-input"
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Retype your password"
            />
          </label>

          {error ? <p className="auth-error">{error}</p> : null}

          <button className="auth-button" type="submit" disabled={loading}>
            {loading ? <span className="auth-spinner" aria-hidden="true" /> : null}
            {loading ? "Creating account..." : "Register"}
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
