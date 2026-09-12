"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripePromise } from "@/lib/stripeClientPromise";

type LedgerEntryType = "MONTHLY_GRANT" | "TOPUP_PURCHASE" | "AI_USAGE" | "REFUND" | "ADJUSTMENT";

function IconSparkle() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    </svg>
  );
}

type LedgerEntry = {
  id: string;
  type: LedgerEntryType;
  amount: number;
  description: string | null;
  createdAt: string;
};

type Props = {
  plan: "FREE" | "PRO" | "ULTRA";
  allowanceBalance: number;
  topupBalance: number;
  allowanceResetAt: string;
  recentActivity: LedgerEntry[];
};

type CheckoutBody =
  | { kind: "subscription"; plan: "PRO" | "ULTRA" }
  | { kind: "topup"; pack: "SMALL" | "MEDIUM" | "LARGE" }
  | { kind: "funnel_addon_slot" };

type FunnelSlotsSummary = { total: number; used: number; hasSlotAvailable: boolean };

const TYPE_LABELS: Record<LedgerEntryType, string> = {
  MONTHLY_GRANT: "Monthly grant",
  TOPUP_PURCHASE: "Credit purchase",
  AI_USAGE: "AI generation",
  REFUND: "Refund",
  ADJUSTMENT: "Adjustment",
};

const TOPUP_PACKS: Array<{ pack: "SMALL" | "MEDIUM" | "LARGE"; label: string; sub: string }> = [
  { pack: "SMALL", label: "5,000 credits", sub: "Small top-up" },
  { pack: "MEDIUM", label: "25,000 credits", sub: "Medium top-up" },
  { pack: "LARGE", label: "120,000 credits", sub: "Large top-up" },
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
  background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
  color: "#fff",
  fontFamily: "inherit",
  boxShadow: "0 3px 14px var(--brand-glow)",
  textAlign: "left",
};

const secondaryButtonStyle: CSSProperties = {
  ...actionButtonStyle,
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "rgba(240,242,255,0.75)",
  boxShadow: "none",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function daysUntil(iso: string): number {
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

/** The card-entry step now renders in this modal (Stripe's embedded Checkout, an iframe) —
 * the visitor never leaves the app to pay. Stripe still does one final navigation to
 * `return_url` once payment completes (that part of embedded Checkout isn't avoidable), which
 * is what BillingSection's own ?session_id handling below picks up. */
function CheckoutModal({ clientSecret, onClose }: { clientSecret: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200, background: "rgba(6,7,15,0.75)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560, maxHeight: "90vh",
          overflow: "auto", position: "relative", boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute", top: "0.75rem", right: "0.75rem", zIndex: 1, width: 30, height: 30,
            display: "grid", placeItems: "center", background: "rgba(15,15,25,0.06)", border: "none",
            borderRadius: 8, color: "rgba(15,15,25,0.6)", cursor: "pointer", fontSize: "1rem", lineHeight: 1,
          }}
        >
          ✕
        </button>
        <EmbeddedCheckoutProvider stripe={getStripePromise()} options={{ clientSecret }}>
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
    </div>
  );
}

export function BillingSection({ plan, allowanceBalance, topupBalance, allowanceResetAt, recentActivity }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [busyAction, setBusyAction] = useState<string | null>(null);
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
  // payment (see CheckoutModal's comment) — confirms the real status via our own backend
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

  // A Pro/Ultra-gated feature elsewhere in the dashboard (e.g. Domains' custom-domain
  // upsell) navigates here with ?upgrade=PRO|ULTRA instead of trying to start embedded
  // checkout itself — this is the one place that already knows how (EmbeddedCheckoutProvider
  // below, startCheckout's own working clientSecret flow), so every upsell entry point
  // reuses it rather than re-implementing it. Auto-fires the same checkout a clicking the
  // matching plan button would, once, on arrival.
  useEffect(() => {
    const upgrade = searchParams.get("upgrade");
    if (upgrade !== "PRO" && upgrade !== "ULTRA") return;
    // Read and captured as a local before router.replace strips the query string below —
    // startCheckout's async POST (fired right after, in this same effect) still closes
    // over this value regardless of what the URL looks like by the time it resolves.
    const returnTo = searchParams.get("returnTo");
    router.replace(pathname);
    void startCheckout({ kind: "subscription", plan: upgrade }, `sub-${upgrade}`, isSafeReturnTo(returnTo) ? returnTo : null);
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

  async function startCheckout(body: CheckoutBody, actionKey: string, returnTo: string | null = null): Promise<void> {
    setBusyAction(actionKey);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(returnTo ? { ...body, returnTo } : body),
      });
      const data = (await res.json()) as { clientSecret?: string; error?: string };
      if (!res.ok || !data.clientSecret) throw new Error(data.error ?? "Could not start checkout.");
      setCheckoutSecret(data.clientSecret);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout.");
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
      if (!res.ok || !data.url) throw new Error(data.error ?? "Could not open billing portal.");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing portal.");
      setBusyAction(null);
    }
  }

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
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
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexWrap: "wrap",
          gap: "0.75rem",
        }}
      >
        <div>
          <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700, color: "#f0f2ff" }}>
            Billing &amp; Credits
          </h2>
          <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.35)" }}>
            System AI usage (accounts without a configured BYOK key) draws from this balance.
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
            color: "var(--brand)",
            border: "1px solid rgba(var(--brand-rgb),0.25)",
          }}
        >
          {plan} plan
        </span>
      </div>

      <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {checkoutStatus && (
          <div
            style={{
              display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.7rem 1rem", borderRadius: 10, fontSize: "0.82rem",
              background: checkoutStatus.kind === "success" ? "rgba(52,211,153,0.1)" : checkoutStatus.kind === "error" ? "rgba(248,113,113,0.1)" : "rgba(251,191,36,0.1)",
              border: `1px solid ${checkoutStatus.kind === "success" ? "rgba(52,211,153,0.25)" : checkoutStatus.kind === "error" ? "rgba(248,113,113,0.25)" : "rgba(251,191,36,0.25)"}`,
              color: checkoutStatus.kind === "success" ? "#4ade80" : checkoutStatus.kind === "error" ? "#f87171" : "#fbbf24",
            }}
          >
            {checkoutStatus.text}
          </div>
        )}

        {/* Balance */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem" }}>
          <div>
            <p style={{ fontSize: "0.72rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.4)", marginBottom: "0.25rem" }}>
              Total balance
            </p>
            <p style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f0f2ff" }}>{total.toLocaleString()} credits</p>
          </div>
          <div>
            <p style={{ fontSize: "0.72rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.4)", marginBottom: "0.25rem" }}>
              Monthly allowance
            </p>
            <p style={{ fontSize: "0.95rem", fontWeight: 600, color: "rgba(240,242,255,0.75)" }}>{allowanceBalance.toLocaleString()} left</p>
            <p suppressHydrationWarning style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.35)" }}>
              Resets in {daysUntil(allowanceResetAt)}d ({formatDate(allowanceResetAt)})
            </p>
          </div>
          <div>
            <p style={{ fontSize: "0.72rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.4)", marginBottom: "0.25rem" }}>
              Top-up balance
            </p>
            <p style={{ fontSize: "0.95rem", fontWeight: 600, color: "rgba(240,242,255,0.75)" }}>{topupBalance.toLocaleString()}</p>
            <p style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.35)" }}>Never expires</p>
          </div>
        </div>

        {/* Plan actions */}
        <div>
          <p style={{ fontSize: "0.78rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.4)", marginBottom: "0.5rem" }}>
            Plan
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
            {plan === "FREE" && (
              <button
                type="button"
                disabled={busyAction === "sub-PRO"}
                onClick={() => void startCheckout({ kind: "subscription", plan: "PRO" }, "sub-PRO")}
                style={{ ...actionButtonStyle, opacity: busyAction === "sub-PRO" ? 0.7 : 1 }}
              >
                {busyAction === "sub-PRO" ? "Opening…" : "Upgrade to PRO"}
              </button>
            )}
            {plan !== "ULTRA" && (
              <button
                type="button"
                disabled={busyAction === "sub-ULTRA"}
                onClick={() => void startCheckout({ kind: "subscription", plan: "ULTRA" }, "sub-ULTRA")}
                style={{ ...actionButtonStyle, opacity: busyAction === "sub-ULTRA" ? 0.7 : 1 }}
              >
                {busyAction === "sub-ULTRA" ? "Opening…" : "Upgrade to ULTRA"}
              </button>
            )}
            {plan === "ULTRA" && (
              <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#34d399", padding: "0.5rem 0.9rem", borderRadius: 9, background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                Current Plan: ULTRA <IconSparkle />
              </span>
            )}
            <button
              type="button"
              disabled={busyAction === "portal"}
              onClick={() => void openPortal()}
              style={{ ...secondaryButtonStyle, opacity: busyAction === "portal" ? 0.7 : 1 }}
            >
              {busyAction === "portal" ? "Opening…" : "Manage subscription"}
            </button>
          </div>
        </div>

        {/* Funnel add-on slots */}
        {funnelSlots && (
          <div>
            <p style={{ fontSize: "0.78rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.4)", marginBottom: "0.5rem" }}>
              Funnel slots
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.83rem", color: "rgba(240,242,255,0.6)" }}>
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
            <p style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.35)", marginTop: "0.4rem" }}>
              Billed monthly, per slot. Cancel any time from "Manage subscription" above.
            </p>
          </div>
        )}

        {/* Top-up packs */}
        <div>
          <p style={{ fontSize: "0.78rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.4)", marginBottom: "0.5rem" }}>
            Buy credits
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.6rem" }}>
            {TOPUP_PACKS.map(({ pack, label, sub }) => {
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
                  <span style={{ fontSize: "0.68rem", opacity: 0.7, fontWeight: 500 }}>{sub}</span>
                </button>
              );
            })}
          </div>
        </div>

        {error && <p style={{ fontSize: "0.78rem", color: "#f87171" }}>{error}</p>}

        {/* Recent activity */}
        <div>
          <p style={{ fontSize: "0.78rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.4)", marginBottom: "0.5rem" }}>
            Recent activity
          </p>
          {recentActivity.length === 0 ? (
            <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.35)" }}>No credit activity yet.</p>
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
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.05)",
                    fontSize: "0.8rem",
                    gap: "0.75rem",
                  }}
                >
                  <div>
                    <p style={{ color: "#f0f2ff", fontWeight: 600 }}>{TYPE_LABELS[entry.type]}</p>
                    <p style={{ color: "rgba(240,242,255,0.35)", fontSize: "0.7rem" }}>
                      {entry.description ?? "—"} · {formatDate(entry.createdAt)}
                    </p>
                  </div>
                  <span style={{ fontWeight: 700, color: entry.amount >= 0 ? "#34d399" : "#f87171", whiteSpace: "nowrap" }}>
                    {entry.amount >= 0 ? "+" : ""}
                    {entry.amount.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {checkoutSecret && <CheckoutModal clientSecret={checkoutSecret} onClose={() => setCheckoutSecret(null)} />}
    </div>
  );
}
