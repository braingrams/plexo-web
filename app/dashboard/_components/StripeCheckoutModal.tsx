"use client";

import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripePromise } from "@/lib/stripeClientPromise";

/** The card form for US-dollar payments (Stripe's embedded Checkout, an iframe) — the person
 * never leaves the app to pay. Stripe does one final navigation to the return URL once payment
 * completes, which the Subscription page's ?session_id handling picks up. */
export function StripeCheckoutModal({ clientSecret, onClose }: { clientSecret: string; onClose: () => void }) {
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
