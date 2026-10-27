"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  plan: "PRO" | "ULTRA";
  /** The account hasn't used its one free trial yet. */
  canTrial: boolean;
  trialDays: number;
};

const PLAN_LABEL: Record<Props["plan"], string> = { PRO: "Pro", ULTRA: "Ultra" };

export function CompleteSubscriptionClient({ plan, canTrial, trialDays }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<"trial" | "pay" | "free" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hands off to the Subscription settings page (?upgrade=PRO|ULTRA triggers the same
  // startCheckout flow there automatically on arrival) rather than starting embedded
  // Checkout here directly — this used to POST /api/billing/checkout itself and expect a
  // `url` back to redirect to (the older hosted-Checkout response shape); that route now
  // always creates an embedded-mode session and only ever returns `clientSecret`, so this
  // unconditionally failed with "Could not start checkout."
  function continueToPayment(): void {
    setLoading("pay");
    router.push(`/dashboard/settings/subscription?upgrade=${plan}&returnTo=${encodeURIComponent("/dashboard")}`);
  }

  async function startTrial(): Promise<void> {
    setLoading("trial");
    setError(null);
    try {
      const res = await fetch("/api/billing/trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not start your trial.");
      router.push("/dashboard?trial=started");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start your trial.");
      setLoading(null);
    }
  }

  async function continueOnFree(): Promise<void> {
    setLoading("free");
    setError(null);
    try {
      // Clears the plan picked at signup and stops the trial being offered again.
      const res = await fetch("/api/billing/trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismiss: true }),
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
        <h1 className="auth-title">{canTrial ? `Try ${PLAN_LABEL[plan]} free for ${trialDays} days` : `Finish setting up ${PLAN_LABEL[plan]}`}</h1>
        <p className="auth-subtitle">
          {canTrial
            ? `Your account is ready. Start with every ${PLAN_LABEL[plan]} feature unlocked — no card needed. We'll remind you before the trial ends, and nothing you build is ever deleted.`
            : `Your account is created — complete payment to activate your ${PLAN_LABEL[plan]} plan and unlock its features.`}
        </p>

        {error ? (
          <p className="auth-error" role="alert">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </p>
        ) : null}

        {canTrial ? (
          <button className="auth-button" type="button" disabled={loading !== null} onClick={() => void startTrial()}>
            {loading === "trial" ? <span className="auth-spinner" aria-hidden="true" /> : null}
            {loading === "trial" ? "Starting your trial…" : `Start my free ${PLAN_LABEL[plan]} trial`}
          </button>
        ) : null}

        <button
          className={canTrial ? "auth-button auth-button-secondary" : "auth-button"}
          type="button"
          disabled={loading !== null}
          onClick={() => void continueToPayment()}
          style={canTrial ? { marginTop: "0.75rem", background: "transparent", border: "1px solid var(--surface-border)", color: "var(--text-main)" } : undefined}
        >
          {loading === "pay" ? <span className="auth-spinner" aria-hidden="true" /> : null}
          {loading === "pay" ? "Redirecting…" : canTrial ? `Pay now and skip the trial` : `Continue to payment for ${PLAN_LABEL[plan]}`}
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
