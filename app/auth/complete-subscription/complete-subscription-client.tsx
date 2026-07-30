"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  plan: "PRO" | "ULTRA";
};

const PLAN_LABEL: Record<Props["plan"], string> = { PRO: "Pro", ULTRA: "Ultra" };

export function CompleteSubscriptionClient({ plan }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<"pay" | "free" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function continueToPayment(): Promise<void> {
    setLoading("pay");
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "subscription", plan }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Could not start checkout.");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout.");
      setLoading(null);
    }
  }

  async function continueOnFree(): Promise<void> {
    setLoading("free");
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingPlan: null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not update your plan.");
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update your plan.");
      setLoading(null);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1 className="auth-title">Finish setting up {PLAN_LABEL[plan]}</h1>
        <p className="auth-subtitle">
          Your account is created — complete payment to activate your {PLAN_LABEL[plan]} plan and unlock its features.
        </p>

        {error ? (
          <p className="auth-error" role="alert">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </p>
        ) : null}

        <button
          className="auth-button"
          type="button"
          disabled={loading !== null}
          onClick={() => void continueToPayment()}
        >
          {loading === "pay" ? <span className="auth-spinner" aria-hidden="true" /> : null}
          {loading === "pay" ? "Redirecting…" : `Continue to payment for ${PLAN_LABEL[plan]}`}
        </button>

        <p className="auth-meta">
          Changed your mind?{" "}
          <button
            type="button"
            className="auth-link"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit" }}
            disabled={loading !== null}
            onClick={() => void continueOnFree()}
          >
            {loading === "free" ? "Switching…" : "Continue on Free instead"}
          </button>
        </p>
      </section>
    </main>
  );
}
