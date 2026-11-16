"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Rocket } from "lucide-react";
import { AuthShell } from "@/app/auth/_kit/AuthShell";
import { Alert, Button, PageHead } from "@/app/auth/_kit/ui";
import { PLAN_LABELS, type PaidPlanId } from "@/lib/plan/plans";
import { usePricing } from "@/app/dashboard/_components/usePricing";

type Props = {
  plan: PaidPlanId;
  /** The account hasn't used its one free trial yet. */
  canTrial: boolean;
  trialDays: number;
};

const PLAN_LABEL = PLAN_LABELS;

export function CompleteSubscriptionClient({ plan, canTrial, trialDays }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<"trial" | "pay" | "free" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { pricing } = usePricing();
  const price = pricing ? pricing.plans[plan] : null;
  const priceText = price ? `${price.isFromPrice ? "from " : ""}${price.monthlyLabel}/month` : null;

  // Hands off to the Subscription settings page (?upgrade=STARTER|PRO|ENTERPRISE starts the
  // checkout there on arrival — Stripe's card form or Paystack's popup, whichever the
  // person's region uses), which handles every outcome and then returns to the dashboard.
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
    <AuthShell layout="center">
      <div className="ax-center-text">
        <div className="ax-badge-icon ax-lime"><Rocket size={30} aria-hidden="true" /></div>
        <PageHead title={canTrial ? `Try ${PLAN_LABEL[plan]} free for ${trialDays} days` : `Finish setting up ${PLAN_LABEL[plan]}`}>
          {canTrial
            ? `Your account is ready. Start with ${PLAN_LABEL[plan]} unlocked — no card needed. Custom domains, taking real payments and your own branding switch on once you subscribe. We'll remind you before the trial ends, and nothing you build is ever deleted.`
            : `Your account is created — complete payment to activate your ${PLAN_LABEL[plan]} plan${priceText ? ` (${priceText})` : ""} and unlock its features.`}
        </PageHead>

        <div className="ax-stack" style={{ textAlign: "left" }}>
          {error ? <Alert tone="error">{error}</Alert> : null}

          {canTrial ? (
            <Button type="button" loading={loading === "trial"} disabled={loading !== null} onClick={() => void startTrial()}>
              {loading === "trial" ? "Starting your trial…" : `Start my free ${PLAN_LABEL[plan]} trial`}
            </Button>
          ) : null}

          <Button type="button" variant={canTrial ? "secondary" : "primary"} loading={loading === "pay"} disabled={loading !== null} onClick={() => void continueToPayment()}>
            {loading === "pay" ? "Redirecting…" : canTrial ? `Pay now${priceText ? ` (${priceText})` : ""} and skip the trial` : `Continue to payment for ${PLAN_LABEL[plan]}`}
          </Button>
        </div>

        <p className="ax-foot">
          Changed your mind?{" "}
          <button type="button" className="ax-link" disabled={loading !== null} onClick={() => void continueOnFree()}>
            {loading === "free" ? "Switching…" : "Continue on Free instead"}
          </button>
        </p>
      </div>
    </AuthShell>
  );
}
