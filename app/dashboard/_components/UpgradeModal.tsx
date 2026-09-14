"use client";

import { useState } from "react";

/** Generic plan-upgrade prompt — deep-links into /dashboard/settings/subscription's
 * existing ?upgrade=PRO|ULTRA&returnTo=… contract (see billing-section.tsx), same as
 * domains-client.tsx's inline startUpgradeCheckout, just reusable across features. */
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
  targetPlan: "PRO" | "ULTRA";
  returnTo: string;
}) {
  const [redirecting, setRedirecting] = useState(false);
  if (!open) return null;

  function startUpgrade(): void {
    setRedirecting(true);
    window.location.href = `/dashboard/settings/subscription?upgrade=${targetPlan}&returnTo=${encodeURIComponent(returnTo)}`;
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(5,6,12,0.7)",
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
          background: "rgba(16,18,28,0.98)",
          border: "1px solid rgba(255,255,255,0.09)",
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
            color: "#f0f2ff",
            marginBottom: "0.6rem",
          }}
        >
          {title}
        </h2>
        <p
          style={{
            fontSize: "0.85rem",
            color: "rgba(240,242,255,0.6)",
            marginBottom: "1.25rem",
          }}
        >
          {message}
        </p>
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
              border: "1px solid rgba(255,255,255,0.1)",
              background: "transparent",
              color: "rgba(240,242,255,0.65)",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            Not now
          </button>
          <button
            type="button"
            onClick={startUpgrade}
            disabled={redirecting}
            style={{
              padding: "0.65rem 1.4rem",
              borderRadius: 9,
              border: "none",
              background:
                "linear-gradient(135deg,var(--brand),var(--brand-deep))",
              color: "#fff",
              cursor: redirecting ? "default" : "pointer",
              opacity: redirecting ? 0.7 : 1,
              fontFamily: "inherit",
              fontSize: "0.875rem",
              fontWeight: 700,
              boxShadow: "0 4px 16px var(--brand-glow)",
            }}
          >
            {redirecting
              ? "Redirecting…"
              : `Upgrade to ${targetPlan === "PRO" ? "Pro" : "Ultra"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
