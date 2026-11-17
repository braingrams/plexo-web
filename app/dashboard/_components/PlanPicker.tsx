"use client";

import type { CSSProperties } from "react";
import { useState } from "react";

import { getTierFeatures } from "@/lib/subscription";
import { planMonthlyCredits } from "@/lib/credits/value";
import { PLAN_LABELS, PLAN_RANK, type PaidPlanId, type PlanId } from "@/lib/plan/plans";
import type { BillingInterval, PricingView } from "@/lib/billing/pricing";
import { startCheckout, type CheckoutResult } from "@/lib/billing/clientCheckout";
import { StripeCheckoutModal } from "./StripeCheckoutModal";
import { currencyName, usePricing } from "./usePricing";
import { startTrial } from "./trial";

// The four plans side by side, in the person's own currency, with one "Upgrade" button each.
// Which payment provider runs the checkout (Stripe in US dollars, Paystack in naira/cedis/
// shillings/rand) is decided by the server from where they are — the button is the same.

const PLANS: PlanId[] = ["FREE", "STARTER", "PRO", "ENTERPRISE"];

const TAGLINES: Record<PlanId, string> = {
  FREE: "Try Plexo with a one-page site.",
  STARTER: "One full website with a blog and a store.",
  PRO: "Several websites, your own payment keys, server apps.",
  ENTERPRISE: "Your brand everywhere, with a dedicated contact.",
};

function custom(plan: PlanId, text: string): string {
  return plan === "ENTERPRISE" ? "Custom" : text;
}

/** The comparison rows — read from the plan table itself, so they can't drift from what's enforced. */
export function planHighlights(plan: PlanId): { label: string; value: string }[] {
  const f = getTierFeatures(plan);
  const websites = f.maxPublishedPagesPerSite === 1 ? "1 page (homepage)" : f.maxPublishedSites === null ? "Unlimited" : `${f.maxPublishedSites} website${f.maxPublishedSites === 1 ? "" : "s"}, all pages`;
  const domains =
    f.maxCustomDomains === 0
      ? "Plexo address only"
      : `${f.maxCustomDomains} custom domain${f.maxCustomDomains === 1 ? "" : "s"}${f.includedFreeDomains ? ` + ${f.includedFreeDomains} free domain` : ""}`;
  return [
    { label: "Websites", value: custom(plan, websites) },
    { label: "Funnels", value: custom(plan, f.includedFunnelSlots ? String(f.includedFunnelSlots) : "—") },
    { label: "Store", value: f.commerceEnabled ? `${f.maxCommerceProducts.toLocaleString("en-US")} products${f.ownPaymentKeysEnabled ? ", your own payment keys" : ""}` : "—" },
    { label: "Blog", value: f.blogEnabled ? "Unlimited posts" : "—" },
    { label: "Email templates", value: custom(plan, String(f.maxEmailTemplates)) },
    { label: "AI credits / month", value: planMonthlyCredits(plan).toLocaleString("en-US") },
    { label: "Domains", value: domains },
    { label: "Plexo badge", value: f.whiteLabelEnabled ? "Your own brand" : f.brandingRemovalEnabled ? "Removable" : "Shown" },
    { label: "Team", value: f.teamSeats === 0 ? "Just you" : custom(plan, `${f.teamSeats} teammates`) },
    { label: "Analytics", value: f.analyticsEnabled ? "Included" : "—" },
    { label: "Support", value: f.supportLabel },
  ];
}

const primaryButton: CSSProperties = {
  width: "100%",
  padding: "0.6rem 0.9rem",
  borderRadius: 9,
  border: "none",
  cursor: "pointer",
  fontSize: "0.82rem",
  fontWeight: 700,
  background: "var(--plx-brand, linear-gradient(135deg,var(--brand),var(--brand-deep)))",
  color: "var(--plx-text, #fff)",
  fontFamily: "inherit",
};
const secondaryButton: CSSProperties = {
  ...primaryButton,
  background: "transparent",
  border: "1px solid color-mix(in srgb, var(--plx-text, #fff) 12%, transparent)",
  color: "var(--plx-text, rgba(240,242,255,0.8))",
};

export function priceLine(pricing: PricingView | null, plan: PlanId, interval: BillingInterval): { main: string; sub: string | null } {
  if (plan === "FREE") return { main: "Free", sub: "forever" };
  if (!pricing) return { main: "…", sub: null };
  const p = pricing.plans[plan as PaidPlanId];
  const from = p.isFromPrice ? "from " : "";
  if (interval === "yearly") return { main: `${from}${p.yearlyLabel}/yr`, sub: `${p.yearlyPerMonthLabel}/mo, billed yearly` };
  return { main: `${from}${p.monthlyLabel}/mo`, sub: null };
}

export function CurrencySwitch({ pricing, onSwitch }: { pricing: PricingView | null; onSwitch: (to: "USD" | "LOCAL") => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!pricing?.currencyChoice) return null;
  const { payingInUsd, localCurrency } = pricing.currencyChoice;
  return (
    <span style={{ fontSize: "0.75rem", color: "var(--plx-muted, rgba(240,242,255,0.5))" }}>
      Prices in {currencyName(pricing.currency)} ·{" "}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void onSwitch(payingInUsd ? "LOCAL" : "USD").then((err) => {
            setError(err);
            setBusy(false);
          });
        }}
        style={{ background: "none", border: "none", padding: 0, color: "var(--plx-link, var(--brand))", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", textDecoration: "underline" }}
      >
        {busy ? "Switching…" : payingInUsd ? `Pay in ${currencyName(localCurrency)} instead` : "Pay in USD instead"}
      </button>
      {error && <span style={{ color: "var(--plx-danger, #f87171)", marginLeft: 6 }}>{error}</span>}
    </span>
  );
}

export function PlanPicker({
  currentPlan,
  paying,
  currentInterval,
  trialAvailable = false,
  returnTo,
  onResult,
}: {
  /** The plan the account is on right now. */
  currentPlan: PlanId;
  /** A paid subscription is behind it (not a trial or a grant). */
  paying: boolean;
  currentInterval?: BillingInterval | null;
  trialAvailable?: boolean;
  /** Where to land after paying (a safe, same-site path). */
  returnTo?: string | null;
  /** A payment finished, changed the plan, failed… — the parent shows the message. */
  onResult?: (result: CheckoutResult) => void;
}) {
  const { pricing, switchCurrency } = usePricing();
  const [interval, setInterval] = useState<BillingInterval>(currentInterval ?? "monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const monthsFree = pricing?.plans.STARTER.yearlyMonthsFree ?? 2;

  async function upgrade(plan: PaidPlanId): Promise<void> {
    setBusy(plan);
    const result = await startCheckout({ kind: "subscription", plan, interval, ...(returnTo ? { returnTo } : {}) });
    setBusy(null);
    if (result.kind === "stripe") setClientSecret(result.clientSecret);
    else onResult?.(result);
  }

  function tryFree(plan: "STARTER" | "PRO"): void {
    setBusy(`trial-${plan}`);
    void startTrial(plan, returnTo ?? undefined).catch((err) => {
      onResult?.({ kind: "error", message: err instanceof Error ? err.message : "Couldn't start your trial." });
      setBusy(null);
    });
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem", marginBottom: "0.8rem" }}>
        <div role="group" aria-label="Billing period" style={{ display: "inline-flex", border: "1px solid color-mix(in srgb, var(--plx-text, #fff) 10%, transparent)", borderRadius: 9, overflow: "hidden" }}>
          {(["monthly", "yearly"] as const).map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => setInterval(i)}
              aria-pressed={interval === i}
              style={{
                padding: "0.4rem 0.8rem",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: "0.78rem",
                fontWeight: 600,
                background: interval === i ? "color-mix(in srgb, var(--plx-brand, rgb(var(--brand-rgb))) 18%, transparent)" : "transparent",
                color: interval === i ? "var(--plx-text, #f0f2ff)" : "color-mix(in srgb, var(--plx-text, rgb(240 242 255)) 55%, transparent)",
              }}
            >
              {i === "monthly" ? "Monthly" : `Yearly · ${monthsFree} months free`}
            </button>
          ))}
        </div>
        <CurrencySwitch pricing={pricing} onSwitch={switchCurrency} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.75rem" }}>
        {PLANS.map((plan) => {
          const isCurrent = plan === currentPlan && (plan === "FREE" || paying) && (plan === "FREE" || !currentInterval || currentInterval === interval);
          const price = priceLine(pricing, plan, interval);
          const higher = PLAN_RANK[plan] > PLAN_RANK[currentPlan];
          const canTrial = trialAvailable && currentPlan === "FREE" && (plan === "STARTER" || plan === "PRO");
          return (
            <div
              key={plan}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.6rem",
                padding: "1rem",
                borderRadius: 12,
                background: plan === currentPlan ? "color-mix(in srgb, var(--plx-brand, rgb(var(--brand-rgb))) 7%, transparent)" : "color-mix(in srgb, var(--plx-text, #fff) 2%, transparent)",
                border: `1px solid ${plan === currentPlan ? "color-mix(in srgb, var(--plx-brand, rgb(var(--brand-rgb))) 35%, transparent)" : "color-mix(in srgb, var(--plx-text, #fff) 7%, transparent)"}`,
              }}
            >
              <div>
                <p style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--plx-text, #f0f2ff)" }}>{PLAN_LABELS[plan]}</p>
                <p style={{ fontSize: "0.72rem", color: "var(--plx-muted, rgba(240,242,255,0.45))", minHeight: "2.1em" }}>{TAGLINES[plan]}</p>
              </div>
              <div>
                <p style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--plx-text, #f0f2ff)" }}>{price.main}</p>
                {price.sub && <p style={{ fontSize: "0.7rem", color: "var(--plx-muted, rgba(240,242,255,0.45))" }}>{price.sub}</p>}
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.3rem", flex: 1 }}>
                {planHighlights(plan).map((row) => (
                  <li key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", fontSize: "0.72rem" }}>
                    <span style={{ color: "var(--plx-muted, rgba(240,242,255,0.45))" }}>{row.label}</span>
                    <span style={{ color: row.value === "—" ? "color-mix(in srgb, var(--plx-text, rgb(240 242 255)) 30%, transparent)" : "color-mix(in srgb, var(--plx-text, rgb(240 242 255)) 85%, transparent)", textAlign: "right" }}>{row.value}</span>
                  </li>
                ))}
              </ul>
              {plan === "FREE" ? (
                currentPlan === "FREE" ? <p style={{ fontSize: "0.75rem", color: "var(--plx-muted, rgba(240,242,255,0.5))", textAlign: "center" }}>Your plan</p> : null
              ) : isCurrent ? (
                <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--plx-success, #34d399)", textAlign: "center" }}>Your plan</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  {canTrial && (
                    <button type="button" disabled={busy !== null} onClick={() => tryFree(plan as "STARTER" | "PRO")} style={{ ...secondaryButton, opacity: busy === `trial-${plan}` ? 0.7 : 1 }}>
                      {busy === `trial-${plan}` ? "Starting your trial…" : "Try free for 14 days"}
                    </button>
                  )}
                  <button type="button" disabled={busy !== null || !pricing} onClick={() => void upgrade(plan as PaidPlanId)} style={{ ...primaryButton, opacity: busy === plan ? 0.7 : 1 }}>
                    {busy === plan
                      ? "Opening…"
                      : plan === currentPlan
                        ? paying
                          ? `Switch to ${interval}`
                          : `Keep ${PLAN_LABELS[plan]}`
                        : higher || !paying
                          ? `Upgrade to ${PLAN_LABELS[plan]}`
                          : `Switch to ${PLAN_LABELS[plan]}`}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {trialAvailable && currentPlan === "FREE" && (
        <p style={{ fontSize: "0.72rem", color: "var(--plx-muted, rgba(240,242,255,0.45))", marginTop: "0.6rem" }}>
          The free trial gives you Starter or Pro for 14 days, no card needed. Custom domains, taking real payments and your own branding switch on once you pay. The trial doesn&apos;t add AI credits.
        </p>
      )}
      {clientSecret && <StripeCheckoutModal clientSecret={clientSecret} onClose={() => setClientSecret(null)} />}
    </div>
  );
}
