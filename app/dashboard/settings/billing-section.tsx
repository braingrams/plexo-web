"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { trackEvent, trackPurchaseOnce, subscriptionItem, purchaseTypeFor, analyticsPlan } from "@/lib/analytics";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTopupPacks, packLabel } from "../_components/useTopupPacks";
import { StripeCheckoutModal } from "../_components/StripeCheckoutModal";
import { PlanPicker } from "../_components/PlanPicker";
import { startCheckout as beginCheckout, verifyPaystackPayment, type CheckoutBody, type CheckoutResult } from "@/lib/billing/clientCheckout";
import { PLAN_LABELS, type PlanId } from "@/lib/plan/plans";
import type { BillingInterval } from "@/lib/billing/pricing";

type LedgerEntryType = "MONTHLY_GRANT" | "TOPUP_PURCHASE" | "AI_USAGE" | "REFUND" | "ADJUSTMENT";

type LedgerEntry = {
  id: string;
  type: LedgerEntryType;
  amount: number;
  description: string | null;
  createdAt: string;
};

type Props = {
  plan: PlanId;
  /** A paid subscription is behind the plan (false on Free, a trial, or an admin grant). */
  paying?: boolean;
  /** One plain-language line on where the plan stands (trial days left, kept by Plexo, …). */
  planNote?: { text: string; tone: "info" | "warning" } | null;
  /** The account can still start its one free trial. */
  trialAvailable?: boolean;
  /** Who bills the plan: Stripe (US dollars) or Paystack (local currency). */
  provider?: "STRIPE" | "PAYSTACK" | null;
  interval?: BillingInterval | null;
  /** The plan won't renew (already cancelled). */
  cancelAtPeriodEnd?: boolean;
  /** A plan move booked for the next renewal (the 2026 plan change), with its price. */
  scheduled?: { plan: PlanId; at: string | null; priceLabel: string | null } | null;
  /** "Your price changes to X on <date>." when an admin price change reaches this subscriber's next renewal. */
  priceNotice?: string | null;
  allowanceBalance: number;
  topupBalance: number;
  allowanceResetAt: string;
  recentActivity: LedgerEntry[];
};

type FunnelSlotsSummary = { total: number; used: number; hasSlotAvailable: boolean };

const TYPE_LABELS: Record<LedgerEntryType, string> = {
  MONTHLY_GRANT: "Monthly grant",
  TOPUP_PURCHASE: "Credit purchase",
  AI_USAGE: "AI generation",
  REFUND: "Refund",
  ADJUSTMENT: "Adjustment",
};

// Credits per pack and their price in the person's currency come from the price list (lib/billing/pricing.ts).
const TOPUP_PACKS: Array<{ pack: "SMALL" | "MEDIUM" | "LARGE"; sub: string }> = [
  { pack: "SMALL", sub: "Small top-up" },
  { pack: "MEDIUM", sub: "Medium top-up" },
  { pack: "LARGE", sub: "Large top-up" },
];

const actionButtonStyle: CSSProperties = {
  display: "inline-flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "0.15rem",
  padding: "0.6rem 1rem",
  borderRadius: 9,
  border: "none",
  cursor: "pointer",
  fontSize: "0.8rem",
  fontWeight: 700,
  background: "var(--plx-brand, linear-gradient(135deg,var(--brand),var(--brand-deep)))",
  color: "var(--plx-text, #fff)",
  fontFamily: "inherit",
  boxShadow: "0 3px 14px var(--brand-glow)",
  textAlign: "left",
};

const secondaryButtonStyle: CSSProperties = {
  ...actionButtonStyle,
  background: "transparent",
  border: "1px solid color-mix(in srgb, var(--plx-text, #fff) 10%, transparent)",
  color: "var(--plx-text, rgba(240,242,255,0.75))",
  boxShadow: "none",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function daysUntil(iso: string): number {
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

export function BillingSection({ plan, paying = plan !== "FREE", planNote = null, trialAvailable = false, provider = null, interval = null, cancelAtPeriodEnd = false, scheduled = null, priceNotice = null, allowanceBalance, topupBalance, allowanceResetAt, recentActivity }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const packInfo = useTopupPacks();
  const [error, setError] = useState<string | null>(null);
  const [checkoutSecret, setCheckoutSecret] = useState<string | null>(null);
  const [checkoutStatus, setCheckoutStatus] = useState<{ kind: "success" | "processing" | "error"; text: string } | null>(null);
  const [funnelSlots, setFunnelSlots] = useState<FunnelSlotsSummary | null>(null);

  useEffect(() => {
    fetch("/api/v1/lms/addon-slots")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setFunnelSlots(data))
      .catch(() => {});
  }, []);

  const total = allowanceBalance + topupBalance;

  // A same-origin, root-relative path only — this is threaded to the server and back
  // into a Stripe-hosted return_url, so it must never be treated as safe to redirect to
  // without this check (an absolute/protocol-relative/scheme-carrying value could turn a
  // real completed-payment redirect into an open redirect to an attacker's page).
  function isSafeReturnTo(value: string | null): value is string {
    return !!value && value.startsWith("/") && !value.startsWith("//") && !value.includes("://");
  }

  // Picks up the `?session_id=` Stripe's embedded Checkout lands back on after a completed
  // payment (see StripeCheckoutModal) — confirms the real status via our own backend
  // rather than trusting the query string, then strips it from the URL so a refresh doesn't
  // re-trigger this. The actual plan/credit change is applied by the checkout.session.completed
  // webhook, same as before switching to embedded Checkout — this only drives the banner and a
  // follow-up refresh to reflect it.
  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    if (!sessionId) return;
    // Stripe's own return_url carries this back (see /api/billing/checkout/route.ts) when
    // the upgrade started from elsewhere in the dashboard — sends the user back to where
    // they came from once payment is confirmed, instead of stranding them on this settings
    // page. Absent for a plan change started right here, which keeps today's behavior
    // (refresh in place).
    const returnTo = searchParams.get("returnTo");
    let cancelled = false;
    fetch(`/api/billing/checkout/session?session_id=${encodeURIComponent(sessionId)}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setCheckoutStatus({ kind: "error", text: data.error ?? "Couldn't confirm your payment." });
          return;
        }
        if (data.status === "complete") {
          if (data.paymentStatus === "paid" && data.transactionId && (data.plan === "PRO" || data.plan === "ULTRA")) {
            trackPurchaseOnce(String(data.transactionId), {
              event: "purchase",
              purchase_type: purchaseTypeFor(data.previousPlan),
              previous_plan: analyticsPlan(data.previousPlan ?? "FREE"),
              ecommerce: {
                transaction_id: String(data.transactionId),
                currency: String(data.currency ?? "").toUpperCase(),
                value: Number(data.amount ?? 0) / 100,
                items: [subscriptionItem(data.plan)],
              },
            });
          }
          setCheckoutStatus({ kind: "success", text: "Payment received — your plan is updating now." });
          setTimeout(() => {
            if (cancelled) return;
            if (isSafeReturnTo(returnTo)) {
              router.push(returnTo);
            } else {
              router.refresh();
            }
          }, 2000);
        } else {
          setCheckoutStatus({ kind: "processing", text: "Your payment is still processing — check back in a moment." });
        }
      })
      .catch(() => {
        if (!cancelled) setCheckoutStatus({ kind: "error", text: "Couldn't confirm your payment." });
      });
    router.replace(pathname);
    return () => {
      cancelled = true;
    };
    // Deliberately once-on-mount: reads the session_id that was present on first load, then
    // clears it via router.replace — re-running on searchParams change would just re-fire on
    // that same clear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Paystack (local-currency payments) lands back here with ?paystack=1&reference=… when its
  // popup couldn't be used — confirm the payment with our backend, same as ?session_id above.
  useEffect(() => {
    const reference = searchParams.get("reference") ?? searchParams.get("trxref");
    if (searchParams.get("paystack") !== "1" || !reference) return;
    const returnTo = searchParams.get("returnTo");
    router.replace(pathname);
    let cancelled = false;
    setCheckoutStatus({ kind: "processing", text: "Confirming your payment…" });
    void verifyPaystackPayment(reference).then((result) => {
      if (!cancelled) handleResult(result, isSafeReturnTo(returnTo) ? returnTo : null);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A plan-gated feature elsewhere in the dashboard (e.g. Domains' custom-domain upsell)
  // navigates here with ?upgrade=STARTER|PRO|ENTERPRISE (&interval=yearly) instead of starting
  // checkout itself — this is the one place that handles every outcome (Stripe's card form,
  // Paystack's popup, an in-place plan change). Fires once, on arrival.
  useEffect(() => {
    const raw = searchParams.get("upgrade");
    // ULTRA: a link from before the plan rename (today's Pro).
    const upgrade = raw === "ULTRA" ? "PRO" : raw;
    if (upgrade !== "STARTER" && upgrade !== "PRO" && upgrade !== "ENTERPRISE") return;
    const interval = searchParams.get("interval") === "yearly" ? "yearly" : "monthly";
    // Read and captured as a local before router.replace strips the query string below.
    const returnTo = searchParams.get("returnTo");
    router.replace(pathname);
    void startCheckout({ kind: "subscription", plan: upgrade, interval }, `sub-${upgrade}`, isSafeReturnTo(returnTo) ? returnTo : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Same deep-link principle as ?upgrade= above — hitting the Funnels module's slot limit
  // navigates here with ?addon=funnel_slot instead of starting its own checkout.
  useEffect(() => {
    if (searchParams.get("addon") !== "funnel_slot") return;
    const returnTo = searchParams.get("returnTo");
    router.replace(pathname);
    void startCheckout({ kind: "funnel_addon_slot" }, "addon-funnel-slot", isSafeReturnTo(returnTo) ? returnTo : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Shows what happened after a checkout and, once paid, refreshes (or goes back to where the upgrade started). */
  function handleResult(result: CheckoutResult, returnTo: string | null = null): void {
    switch (result.kind) {
      case "stripe":
        setCheckoutSecret(result.clientSecret);
        return;
      case "changed":
      case "paid":
        setCheckoutStatus({ kind: "success", text: result.message });
        setTimeout(() => (returnTo && isSafeReturnTo(returnTo) ? router.push(returnTo) : router.refresh()), 2000);
        return;
      case "processing":
        setCheckoutStatus({ kind: "processing", text: result.message });
        return;
      case "error":
        setError(result.message);
        return;
      default:
        return; // cancelled, or on the way to Paystack's page
    }
  }

  async function startCheckout(body: CheckoutBody, actionKey: string, returnTo: string | null = null): Promise<void> {
    setBusyAction(actionKey);
    setError(null);
    const result = await beginCheckout(returnTo ? { ...body, returnTo } : body);
    setBusyAction(null);
    // Only PRO has a list price in the analytics helpers; other plans are not tracked yet.
    if (result.kind === "stripe" && body.kind === "subscription" && body.plan === "PRO") {
      // The payment form is open now. Clear the previous ecommerce object first, as the spec requires.
      trackEvent({ ecommerce: null });
      trackEvent({
        event: "begin_checkout",
        checkout_type: "subscription",
        ecommerce: { currency: "USD", value: 19, items: [subscriptionItem(body.plan)] },
      });
    }
    handleResult(result, returnTo);
  }

  async function cancelPlan(): Promise<void> {
    if (!window.confirm("Stop your plan from renewing? Everything keeps working until the end of the period you've paid for.")) return;
    setBusyAction("cancel");
    setError(null);
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "We couldn't cancel your plan.");
      setCheckoutStatus({ kind: "success", text: data.message ?? "Your plan won't renew." });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't cancel your plan.");
    } finally {
      setBusyAction(null);
    }
  }

  async function openPortal(): Promise<void> {
    setBusyAction("portal");
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "We couldn't open your billing page.");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't open your billing page.");
      setBusyAction(null);
    }
  }

  return (
    <div
      style={{
        background: "color-mix(in srgb, var(--plx-text, #fff) 3%, transparent)",
        border: "1px solid color-mix(in srgb, var(--plx-text, #fff) 8%, transparent)",
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "1.25rem 1.5rem",
          borderBottom: "1px solid color-mix(in srgb, var(--plx-text, #fff) 6%, transparent)",
          flexWrap: "wrap",
          gap: "0.75rem",
        }}
      >
        <div>
          <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700, color: "var(--plx-text, #f0f2ff)" }}>
            Billing &amp; Credits
          </h2>
          <p style={{ fontSize: "0.75rem", color: "var(--plx-faint, rgba(240,242,255,0.35))" }}>
            AI features you use without your own AI key draw from this balance.
          </p>
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
            padding: "0.25rem 0.7rem",
            borderRadius: 999,
            fontSize: "0.7rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            background: "var(--brand-subtle)",
            color: "var(--plx-link, var(--brand))",
            border: "1px solid color-mix(in srgb, var(--plx-brand, rgb(var(--brand-rgb))) 25%, transparent)",
          }}
        >
          {PLAN_LABELS[plan]} plan
        </span>
      </div>

      <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {checkoutStatus && (
          <div
            style={{
              display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.7rem 1rem", borderRadius: 10, fontSize: "0.82rem",
              background: checkoutStatus.kind === "success" ? "color-mix(in srgb, var(--plx-success, rgb(52 211 153)) 10%, transparent)" : checkoutStatus.kind === "error" ? "color-mix(in srgb, var(--plx-danger, rgb(248 113 113)) 10%, transparent)" : "color-mix(in srgb, var(--plx-warning, rgb(251 191 36)) 10%, transparent)",
              border: `1px solid ${checkoutStatus.kind === "success" ? "color-mix(in srgb, var(--plx-success, rgb(52 211 153)) 25%, transparent)" : checkoutStatus.kind === "error" ? "color-mix(in srgb, var(--plx-danger, rgb(248 113 113)) 25%, transparent)" : "color-mix(in srgb, var(--plx-warning, rgb(251 191 36)) 25%, transparent)"}`,
              color: checkoutStatus.kind === "success" ? "var(--plx-success, #4ade80)" : checkoutStatus.kind === "error" ? "var(--plx-danger, #f87171)" : "var(--plx-warning, #fbbf24)",
            }}
          >
            {checkoutStatus.text}
          </div>
        )}

        {/* Balance */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem" }}>
          <div>
            <p style={{ fontSize: "0.72rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--plx-muted, rgba(240,242,255,0.4))", marginBottom: "0.25rem" }}>
              Total balance
            </p>
            <p style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--plx-text, #f0f2ff)" }}>{total.toLocaleString()} credits</p>
          </div>
          <div>
            <p style={{ fontSize: "0.72rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--plx-muted, rgba(240,242,255,0.4))", marginBottom: "0.25rem" }}>
              Monthly allowance
            </p>
            <p style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--plx-text, rgba(240,242,255,0.75))" }}>{allowanceBalance.toLocaleString()} left</p>
            <p suppressHydrationWarning style={{ fontSize: "0.7rem", color: "var(--plx-faint, rgba(240,242,255,0.35))" }}>
              Resets in {daysUntil(allowanceResetAt)}d ({formatDate(allowanceResetAt)})
            </p>
          </div>
          <div>
            <p style={{ fontSize: "0.72rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--plx-muted, rgba(240,242,255,0.4))", marginBottom: "0.25rem" }}>
              Top-up balance
            </p>
            <p style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--plx-text, rgba(240,242,255,0.75))" }}>{topupBalance.toLocaleString()}</p>
            <p style={{ fontSize: "0.7rem", color: "var(--plx-faint, rgba(240,242,255,0.35))" }}>Never expires</p>
          </div>
        </div>
        {total < 0 && (
          <p style={{ fontSize: "0.8rem", lineHeight: 1.6, color: "var(--plx-warning, #fcd34d)", background: "color-mix(in srgb, var(--plx-warning, rgb(251 191 36)) 7%, transparent)", border: "1px solid color-mix(in srgb, var(--plx-warning, rgb(251 191 36)) 25%, transparent)", borderRadius: 10, padding: "0.7rem 0.9rem" }}>
            <strong style={{ color: "var(--plx-warning, #fde68a)" }}>Why is my balance below zero?</strong>{" "}Your credits ran out while SOL was partway through a step.
            We let it finish rather than stop, so your work wasn&apos;t left half-done. That amount is taken off your next monthly credits or
            top-up first; until you&apos;re back above zero, SOL waits for you to add credits.
          </p>
        )}

        {/* Plan actions */}
        <div>
          <p style={{ fontSize: "0.78rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--plx-muted, rgba(240,242,255,0.4))", marginBottom: "0.5rem" }}>
            Plan
          </p>
          {planNote && (
            <p
              style={{
                fontSize: "0.82rem", lineHeight: 1.5, marginBottom: "0.75rem", padding: "0.6rem 0.9rem", borderRadius: 10,
                color: planNote.tone === "warning" ? "var(--plx-warning, #fbbf24)" : "color-mix(in srgb, var(--plx-text, rgb(240 242 255)) 75%, transparent)",
                background: planNote.tone === "warning" ? "color-mix(in srgb, var(--plx-warning, rgb(251 191 36)) 8%, transparent)" : "color-mix(in srgb, var(--plx-brand, rgb(var(--brand-rgb))) 7%, transparent)",
                border: `1px solid ${planNote.tone === "warning" ? "color-mix(in srgb, var(--plx-warning, rgb(251 191 36)) 25%, transparent)" : "color-mix(in srgb, var(--plx-brand, rgb(var(--brand-rgb))) 25%, transparent)"}`,
              }}
            >
              {planNote.text}
            </p>
          )}
          {scheduled && (
            <p
              style={{
                fontSize: "0.82rem", lineHeight: 1.5, marginBottom: "0.75rem", padding: "0.6rem 0.9rem", borderRadius: 10,
                color: "var(--plx-text, rgba(240,242,255,0.75))", background: "color-mix(in srgb, var(--plx-brand, rgb(var(--brand-rgb))) 7%, transparent)", border: "1px solid color-mix(in srgb, var(--plx-brand, rgb(var(--brand-rgb))) 25%, transparent)",
              }}
            >
              {`From your next renewal${scheduled.at ? ` on ${formatDate(scheduled.at)}` : ""} you'll be on ${PLAN_LABELS[scheduled.plan]}${scheduled.priceLabel ? ` at ${scheduled.priceLabel}` : ""}. It includes everything you have today — nothing for you to do.`}
            </p>
          )}
          {priceNotice && (
            <p
              style={{
                fontSize: "0.82rem", lineHeight: 1.5, marginBottom: "0.75rem", padding: "0.6rem 0.9rem", borderRadius: 10,
                color: "var(--plx-text, rgba(240,242,255,0.75))", background: "color-mix(in srgb, var(--plx-brand, rgb(var(--brand-rgb))) 7%, transparent)", border: "1px solid color-mix(in srgb, var(--plx-brand, rgb(var(--brand-rgb))) 25%, transparent)",
              }}
            >
              {`${priceNotice} Nothing for you to do. Until then you keep paying what you pay now.`}
            </p>
          )}
          <PlanPicker
            currentPlan={plan}
            paying={paying}
            currentInterval={interval}
            trialAvailable={plan === "FREE" && trialAvailable}
            onResult={(result) => handleResult(result)}
          />
          {paying && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.9rem" }}>
              <button
                type="button"
                disabled={busyAction === "portal"}
                onClick={() => void openPortal()}
                style={{ ...secondaryButtonStyle, opacity: busyAction === "portal" ? 0.7 : 1 }}
              >
                {busyAction === "portal" ? "Opening…" : provider === "PAYSTACK" ? "Change card" : "Manage subscription"}
              </button>
              {provider === "PAYSTACK" && !cancelAtPeriodEnd && (
                <button
                  type="button"
                  disabled={busyAction === "cancel"}
                  onClick={() => void cancelPlan()}
                  style={{ ...secondaryButtonStyle, opacity: busyAction === "cancel" ? 0.7 : 1 }}
                >
                  {busyAction === "cancel" ? "Cancelling…" : "Cancel plan"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Funnel add-on slots */}
        {funnelSlots && (
          <div>
            <p style={{ fontSize: "0.78rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--plx-muted, rgba(240,242,255,0.4))", marginBottom: "0.5rem" }}>
              Funnel slots
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.83rem", color: "var(--plx-muted, rgba(240,242,255,0.6))" }}>
                {funnelSlots.used} of {funnelSlots.total} in use
              </span>
              <button
                type="button"
                disabled={busyAction === "addon-funnel-slot"}
                onClick={() => void startCheckout({ kind: "funnel_addon_slot" }, "addon-funnel-slot")}
                style={{ ...secondaryButtonStyle, opacity: busyAction === "addon-funnel-slot" ? 0.7 : 1 }}
              >
                {busyAction === "addon-funnel-slot" ? "Opening…" : "Buy another funnel slot"}
              </button>
            </div>
            <p style={{ fontSize: "0.7rem", color: "var(--plx-faint, rgba(240,242,255,0.35))", marginTop: "0.4rem" }}>
              Billed monthly in US dollars, per slot. Cancel any time from &quot;Manage subscription&quot; above.
            </p>
          </div>
        )}

        {/* Top-up packs */}
        <div>
          <p style={{ fontSize: "0.78rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--plx-muted, rgba(240,242,255,0.4))", marginBottom: "0.5rem" }}>
            Buy credits
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.6rem" }}>
            {TOPUP_PACKS.map(({ pack, sub }) => {
              const label = packLabel(packInfo[pack]);
              const actionKey = `topup-${pack}`;
              return (
                <button
                  key={pack}
                  type="button"
                  disabled={busyAction === actionKey}
                  onClick={() => void startCheckout({ kind: "topup", pack }, actionKey)}
                  style={{ ...actionButtonStyle, opacity: busyAction === actionKey ? 0.7 : 1 }}
                >
                  <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>{busyAction === actionKey ? "Opening…" : label}</span>
                  <span style={{ fontSize: "0.68rem", opacity: 0.7, fontWeight: 500 }}>{packInfo[pack]?.price ?? sub}</span>
                </button>
              );
            })}
          </div>
        </div>

        {error && <p style={{ fontSize: "0.78rem", color: "var(--plx-danger, #f87171)" }}>{error}</p>}

        {/* Recent activity */}
        <div>
          <p style={{ fontSize: "0.78rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--plx-muted, rgba(240,242,255,0.4))", marginBottom: "0.5rem" }}>
            Recent activity
          </p>
          {recentActivity.length === 0 ? (
            <p style={{ fontSize: "0.8rem", color: "var(--plx-faint, rgba(240,242,255,0.35))" }}>No credit activity yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {recentActivity.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.5rem 0.75rem",
                    borderRadius: 9,
                    background: "color-mix(in srgb, var(--plx-text, #fff) 2%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--plx-text, #fff) 5%, transparent)",
                    fontSize: "0.8rem",
                    gap: "0.75rem",
                  }}
                >
                  <div>
                    <p style={{ color: "var(--plx-text, #f0f2ff)", fontWeight: 600 }}>{TYPE_LABELS[entry.type]}</p>
                    <p style={{ color: "var(--plx-faint, rgba(240,242,255,0.35))", fontSize: "0.7rem" }}>
                      {entry.description ?? "—"} · {formatDate(entry.createdAt)}
                    </p>
                  </div>
                  <span style={{ fontWeight: 700, color: entry.amount >= 0 ? "var(--plx-success, #34d399)" : "var(--plx-danger, #f87171)", whiteSpace: "nowrap" }}>
                    {entry.amount >= 0 ? "+" : ""}
                    {entry.amount.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {checkoutSecret && <StripeCheckoutModal clientSecret={checkoutSecret} onClose={() => setCheckoutSecret(null)} />}
    </div>
  );
}
