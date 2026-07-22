"use client";

import type { CSSProperties } from "react";
import { useState } from "react";

type LedgerEntryType = "MONTHLY_GRANT" | "TOPUP_PURCHASE" | "AI_USAGE" | "REFUND" | "ADJUSTMENT";

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
  | { kind: "topup"; pack: "SMALL" | "MEDIUM" | "LARGE" };

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

export function BillingSection({ plan, allowanceBalance, topupBalance, allowanceResetAt, recentActivity }: Props) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = allowanceBalance + topupBalance;

  async function startCheckout(body: CheckoutBody, actionKey: string): Promise<void> {
    setBusyAction(actionKey);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Could not start checkout.");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout.");
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
            border: "1px solid rgba(139,92,246,0.25)",
          }}
        >
          {plan} plan
        </span>
      </div>

      <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
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
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            {plan !== "PRO" && (
              <button
                type="button"
                disabled={busyAction === "sub-PRO"}
                onClick={() => void startCheckout({ kind: "subscription", plan: "PRO" }, "sub-PRO")}
                style={{ ...actionButtonStyle, opacity: busyAction === "sub-PRO" ? 0.7 : 1 }}
              >
                {busyAction === "sub-PRO" ? "Redirecting…" : "Upgrade to PRO"}
              </button>
            )}
            {plan !== "ULTRA" && (
              <button
                type="button"
                disabled={busyAction === "sub-ULTRA"}
                onClick={() => void startCheckout({ kind: "subscription", plan: "ULTRA" }, "sub-ULTRA")}
                style={{ ...actionButtonStyle, opacity: busyAction === "sub-ULTRA" ? 0.7 : 1 }}
              >
                {busyAction === "sub-ULTRA" ? "Redirecting…" : "Upgrade to ULTRA"}
              </button>
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
                  <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>{busyAction === actionKey ? "Redirecting…" : label}</span>
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
    </div>
  );
}
