"use client";

import { useState } from "react";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { CircleAlert, X } from "lucide-react";
import { getStripePromise } from "@/lib/stripeClientPromise";
import type { CreditInfo } from "./types";

// Same pack labels/credit amounts as app/dashboard/settings/billing-section.tsx's own
// TOPUP_PACKS — that file is off-limits to modify/import from (client component with its
// own local const, not exported), so these are kept in exact lockstep with it by value.
const TOPUP_PACKS: Array<{ pack: "SMALL" | "MEDIUM" | "LARGE"; label: string; sub: string }> = [
  { pack: "SMALL", label: "5,000 credits", sub: "Small top-up" },
  { pack: "MEDIUM", label: "25,000 credits", sub: "Medium top-up" },
  { pack: "LARGE", label: "120,000 credits", sub: "Large top-up" },
];

export function CreditExhaustedModal({
  creditInfo,
  returnTo,
  onClose,
}: {
  creditInfo: CreditInfo;
  /** Same-origin path Stripe's return_url ultimately forwards back to once payment is
   * confirmed (see the comment on checkoutSecret below for why this round-trips through
   * /dashboard/settings/subscription first). */
  returnTo: string;
  onClose: () => void;
}) {
  const [busyPack, setBusyPack] = useState<"SMALL" | "MEDIUM" | "LARGE" | null>(null);
  const [checkoutSecret, setCheckoutSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(pack: "SMALL" | "MEDIUM" | "LARGE") {
    setBusyPack(pack);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "topup", pack, returnTo }),
      });
      const data = (await res.json()) as { clientSecret?: string; error?: string };
      if (!res.ok || !data.clientSecret) throw new Error(data.error ?? "Could not start checkout.");
      setCheckoutSecret(data.clientSecret);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout.");
    } finally {
      setBusyPack(null);
    }
  }

  return (
    <div
      onClick={checkoutSecret ? undefined : onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 500,
        background: "rgba(6,4,12,0.78)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: checkoutSecret ? 560 : 460,
          maxHeight: "90vh",
          overflow: "auto",
          borderRadius: 18,
          background: checkoutSecret ? "#fff" : "linear-gradient(165deg, #17101f, #0b0710)",
          border: checkoutSecret ? "none" : "1px solid rgba(168,85,247,0.25)",
          boxShadow: "0 30px 80px -20px rgba(0,0,0,0.6)",
          position: "relative",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: "0.75rem",
            right: "0.75rem",
            zIndex: 2,
            width: 30,
            height: 30,
            borderRadius: 8,
            border: "none",
            background: checkoutSecret ? "rgba(15,15,25,0.06)" : "rgba(255,255,255,0.06)",
            color: checkoutSecret ? "rgba(15,15,25,0.6)" : "rgba(240,242,255,0.6)",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
          }}
        >
          <X size={15} />
        </button>

        {checkoutSecret ? (
          <EmbeddedCheckoutProvider stripe={getStripePromise()} options={{ clientSecret: checkoutSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        ) : (
          <div style={{ padding: "1.75rem" }}>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", marginBottom: "1.25rem" }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(251,191,36,0.12)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <CircleAlert size={17} color="#fbbf24" />
              </span>
              <div>
                <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.05rem", fontWeight: 700, color: "#f3f0fa" }}>Out of credits</h2>
                <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.55)", marginTop: "0.25rem", lineHeight: 1.5 }}>
                  This turn needs about <strong style={{ color: "#e9d5ff" }}>{creditInfo.requiredCredits.toLocaleString()}</strong> credits, but you
                  only have <strong style={{ color: "#e9d5ff" }}>{creditInfo.availableCredits.toLocaleString()}</strong> left. Top up to keep going —
                  your message will stay right where you left it.
                </p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {TOPUP_PACKS.map(({ pack, label, sub }) => (
                <button
                  key={pack}
                  type="button"
                  disabled={busyPack !== null}
                  onClick={() => void startCheckout(pack)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.75rem 1rem",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.03)",
                    color: "#f0f2ff",
                    cursor: busyPack ? "not-allowed" : "pointer",
                    opacity: busyPack && busyPack !== pack ? 0.5 : 1,
                    fontFamily: "inherit",
                    textAlign: "left",
                  }}
                >
                  <span>
                    <span style={{ display: "block", fontSize: "0.88rem", fontWeight: 700 }}>{label}</span>
                    <span style={{ display: "block", fontSize: "0.7rem", color: "rgba(240,242,255,0.4)" }}>{sub}</span>
                  </span>
                  <span
                    style={{
                      fontSize: "0.76rem",
                      fontWeight: 700,
                      color: "#fff",
                      background: "linear-gradient(135deg,#a855f7,#7c3aed)",
                      padding: "0.4rem 0.8rem",
                      borderRadius: 8,
                    }}
                  >
                    {busyPack === pack ? "Opening…" : "Buy"}
                  </span>
                </button>
              ))}
            </div>

            {error && <p style={{ fontSize: "0.78rem", color: "#f87171", marginTop: "0.75rem" }}>{error}</p>}

            <p style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.35)", marginTop: "1rem" }}>
              You'll land back on this conversation once payment is confirmed.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
