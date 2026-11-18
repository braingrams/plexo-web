"use client";

import { useState } from "react";
import { startTrial, useTrialAvailable } from "./trial";
import { usePricing } from "./usePricing";
import { StripeCheckoutModal } from "./StripeCheckoutModal";
import { startCheckout } from "@/lib/billing/clientCheckout";
import { PLAN_LABELS, type PaidPlanId } from "@/lib/plan/plans";

/** Generic plan-upgrade prompt, reusable across features: shows the plan's price in the
 * person's currency and pays right here (Stripe's card form or Paystack's popup — the server
 * picks by region), then returns to `returnTo`. Offers the free trial first while it's unused. */
export function UpgradeModal({
  open,
  onClose,
  title,
  message,
  targetPlan,
  returnTo,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  targetPlan: PaidPlanId;
  returnTo: string;
}) {
  const [redirecting, setRedirecting] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const trial = useTrialAvailable();
  const { pricing } = usePricing();
  if (!open) return null;
  const planName = PLAN_LABELS[targetPlan];
  // Enterprise is arranged, not trialled.
  const canTrial = trial.available && targetPlan !== "ENTERPRISE";
  const price = pricing ? pricing.plans[targetPlan] : null;
  const priceText = price ? `${price.isFromPrice ? "from " : ""}${price.monthlyLabel}/month` : null;

  function tryFree(): void {
    setRedirecting(true);
    setTrialError(null);
    void startTrial(targetPlan === "STARTER" ? "STARTER" : "PRO", returnTo).catch((err) => {
      setTrialError(err instanceof Error ? err.message : "Couldn't start your trial.");
      setRedirecting(false);
    });
  }

  function startUpgrade(): void {
    setRedirecting(true);
    setTrialError(null);
    void startCheckout({ kind: "subscription", plan: targetPlan, interval: "monthly", returnTo }).then((result) => {
      setRedirecting(false);
      if (result.kind === "stripe") setClientSecret(result.clientSecret);
      else if (result.kind === "changed" || result.kind === "paid") {
        setDone(result.message);
        setTimeout(() => (window.location.href = returnTo), 1500);
      } else if (result.kind === "processing") setDone(result.message);
      else if (result.kind === "error") setTrialError(result.message);
    });
  }

  if (clientSecret) return <StripeCheckoutModal clientSecret={clientSecret} onClose={() => setClientSecret(null)} />;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--plx-overlay, rgba(5,6,12,0.7))",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "center",
        zIndex: 200,
        padding: "1rem",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(420px, 100%)",
          background: "var(--plx-surface, rgba(16,18,28,0.98))",
          border: "1px solid color-mix(in srgb, var(--plx-text, #fff) 9%, transparent)",
          borderRadius: 18,
          padding: "1.5rem",
          boxShadow: "0 30px 80px -20px rgba(0,0,0,0.7)",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: "1.05rem",
            fontWeight: 700,
            color: "var(--plx-text, #f0f2ff)",
            marginBottom: "0.6rem",
          }}
        >
          {title}
        </h2>
        <p
          style={{
            fontSize: "0.85rem",
            color: "var(--plx-muted, rgba(240,242,255,0.6))",
            marginBottom: "1.25rem",
          }}
        >
          {message}
        </p>
        {priceText && (
          <p style={{ fontSize: "0.8rem", color: "var(--plx-text, rgba(240,242,255,0.75))", marginTop: "-0.6rem", marginBottom: "1rem" }}>
            {planName} is {priceText}. <a href="/dashboard/settings/subscription" style={{ color: "var(--plx-link, var(--brand))" }}>Compare plans</a>
          </p>
        )}
        {canTrial && (
          <p style={{ fontSize: "0.8rem", color: "var(--plx-violet, #c4b5fd)", marginTop: "-0.4rem", marginBottom: "1.25rem" }}>
            You can try {planName} free for {trial.trialDays} days first — no card needed.
          </p>
        )}
        {done && <p style={{ fontSize: "0.8rem", color: "var(--plx-success, #4ade80)", marginBottom: "1rem" }}>{done}</p>}
        {trialError && <p style={{ fontSize: "0.8rem", color: "var(--plx-danger, #f87171)", marginBottom: "1rem" }}>{trialError}</p>}
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "0.65rem 1.1rem",
              borderRadius: 9,
              border: "1px solid color-mix(in srgb, var(--plx-text, #fff) 10%, transparent)",
              background: "transparent",
              color: "var(--plx-muted, rgba(240,242,255,0.65))",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            Not now
          </button>
          {canTrial && (
            <button
              type="button"
              onClick={startUpgrade}
              disabled={redirecting}
              style={{
                padding: "0.65rem 1.1rem",
                borderRadius: 9,
                border: "1px solid color-mix(in srgb, var(--plx-text, #fff) 14%, transparent)",
                background: "transparent",
                color: "var(--plx-text, #f0f2ff)",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: "0.875rem",
                fontWeight: 600,
              }}
            >
              Pay now
            </button>
          )}
          <button
            type="button"
            onClick={canTrial ? tryFree : startUpgrade}
            disabled={redirecting}
            style={{
              padding: "0.65rem 1.4rem",
              borderRadius: 9,
              border: "none",
              background:
                "var(--plx-brand, linear-gradient(135deg,var(--brand),var(--brand-deep)))",
              color: "var(--plx-text, #fff)",
              cursor: redirecting ? "default" : "pointer",
              opacity: redirecting ? 0.7 : 1,
              fontFamily: "inherit",
              fontSize: "0.875rem",
              fontWeight: 700,
              boxShadow: "0 4px 16px var(--brand-glow)",
            }}
          >
            {redirecting
              ? "One moment…"
              : canTrial
                ? `Try ${planName} free`
                : `Upgrade to ${planName}`}
          </button>
        </div>
      </div>
    </div>
  );
}
