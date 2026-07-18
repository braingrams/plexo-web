"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

import { authClient } from "@/lib/auth-client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      <h1 className="auth-title">Sign In</h1>
      <p className="auth-subtitle">Access your protected Plexo dashboard.</p>

      <form onSubmit={onSubmit}>
        <label className="auth-field">
          <span className="auth-label">Email</span>
          <input
            className="auth-input"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="auth-field">
          <span className="auth-label">Password</span>
          <input
            className="auth-input"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error ? <p className="auth-error">{error}</p> : null}

        <button className="auth-button" type="submit" disabled={loading}>
          {loading ? <span className="auth-spinner" aria-hidden="true" /> : null}
          {loading ? "Signing in..." : "Login"}
        </button>
      </form>

      <p className="auth-meta">
        Forgot password?{" "}
        <Link href="/auth/forgot-password" className="auth-link">
          Reset access
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
            <h1 className="auth-title">Sign In</h1>
            <button className="auth-button" type="button" disabled>
              <span className="auth-spinner" aria-hidden="true" />
              Loading session context...
            </button>
          </section>
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
