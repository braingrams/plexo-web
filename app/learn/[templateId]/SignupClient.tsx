"use client";

import { FormEvent, useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";

function PlexoLogoMark() {
  return (
    <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", display: "grid", placeItems: "center", boxShadow: "0 0 14px rgba(139,92,246,0.4)", flexShrink: 0 }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="white" opacity="0.95" />
        <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

type FunnelMeta = { name: string; signupMode: "FREE" | "PAID"; requireName: boolean; collectPhone: boolean; price: { priceMinor: number; currency: string } | null };

/**
 * Embedded Checkout modal for a funnel's PAID signup — deliberately does NOT reuse
 * lib/stripeClientPromise.ts's getStripePromise() (that's Plexo's own platform key, shared
 * across plan-upgrade/credit-topup checkouts). A funnel's linked product settles through
 * Commerce's own per-site payment config (BYO or platform Stripe — see .../signup/checkout/
 * route.ts), which can be a completely different Stripe account, so this loads Stripe.js
 * fresh with whatever publishableKey that checkout response actually returned — same
 * "runtime-provided key" approach public/commerce.js's vanilla openStripeEmbeddedCheckout
 * already uses for the exact same reason.
 */
function StripeCheckoutModal({ clientSecret, publishableKey, onClose }: { clientSecret: string; publishableKey: string; onClose: () => void }) {
  const [stripePromise] = useState(() => loadStripe(publishableKey));
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(6,7,15,0.75)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560, maxHeight: "90vh", overflow: "auto", position: "relative", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ position: "absolute", top: "0.75rem", right: "0.75rem", zIndex: 1, width: 30, height: 30, display: "grid", placeItems: "center", background: "rgba(15,15,25,0.06)", border: "none", borderRadius: 8, color: "rgba(15,15,25,0.6)", cursor: "pointer", fontSize: "1rem", lineHeight: 1 }}
        >
          ✕
        </button>
        <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
    </div>
  );
}

/** Signup form + "check your email" state, no separate route for the confirmation — same
 * inline-state-swap shape as app/auth/forgot-password/page.tsx, reused deliberately so a
 * visitor's first impression of Plexo-hosted auth looks like one consistent product. */
export function SignupClient({ templateId, funnelName, errorMessage, paidReturn }: { templateId: string; funnelName: string; errorMessage: string | null; paidReturn: boolean }) {
  const [meta, setMeta] = useState<FunnelMeta | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(errorMessage);
  const [sent, setSent] = useState(false);
  const [checkout, setCheckout] = useState<{ clientSecret: string; publishableKey: string } | null>(null);

  useEffect(() => {
    fetch(`/api/public/lms/${templateId}`)
      .then((res) => res.json())
      .then((body) => setMeta(body.error ? null : body))
      .catch(() => {});
  }, [templateId]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const isPaid = meta?.signupMode === "PAID" && !!meta.price;
      const endpoint = isPaid ? `/api/public/lms/${templateId}/signup/checkout` : `/api/public/lms/${templateId}/signup`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isPaid ? { name, email, phone, returnUrl: window.location.href } : { name, email, phone }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Something went wrong.");

      if (!isPaid) {
        setSent(true);
      } else if (body.checkout?.provider === "stripe") {
        setCheckout({ clientSecret: body.checkout.clientSecret, publishableKey: body.checkout.publishableKey });
      } else if (body.authorizationUrl) {
        window.location.href = body.authorizationUrl;
      } else {
        throw new Error("Couldn't start payment. Please try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const ctaLabel = meta?.signupMode === "PAID" && meta.price
    ? `${(meta.price.priceMinor / 100).toFixed(2)} ${meta.price.currency} — Enroll`
    : "Start now — it's free";

  // Real enrollment activation happens asynchronously off the payment webhook, not this
  // page load — this is honestly "payment received," not proof of enrollment yet.
  if (paidReturn) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-logo">
            <PlexoLogoMark />
            <span className="auth-logo-text">{funnelName}</span>
          </div>
          <h1 className="auth-title">Payment received</h1>
          <p className="auth-subtitle">We&apos;re finishing setting up your access — check your email in a moment for your link in.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-logo">
          <PlexoLogoMark />
          <span className="auth-logo-text">{funnelName}</span>
        </div>

        <h1 className="auth-title">{sent ? "Check your email" : funnelName}</h1>
        <p className="auth-subtitle">
          {sent
            ? `We sent a link to ${email} — click it to start.`
            : "Sign up below and we'll send you a link to get started. No password needed."}
        </p>

        {sent ? (
          <div style={{ marginTop: "1.5rem", padding: "1.25rem", borderRadius: 12, background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <p style={{ fontSize: "0.875rem", color: "#34d399", lineHeight: 1.55 }}>
                Didn't get it? Check spam, or wait a minute and try signing up again.
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            {(meta?.requireName ?? true) && (
              <label className="auth-field">
                <span className="auth-label">Name</span>
                <input className="auth-input" type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              </label>
            )}
            <label className="auth-field">
              <span className="auth-label">Email address</span>
              <input className="auth-input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </label>
            {meta?.collectPhone && (
              <label className="auth-field">
                <span className="auth-label">Phone number</span>
                <input className="auth-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
              </label>
            )}

            {error ? (
              <p className="auth-error" role="alert">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {error}
              </p>
            ) : null}

            <button className="auth-button" type="submit" disabled={loading}>
              {loading ? <span className="auth-spinner" aria-hidden="true" /> : null}
              {loading ? "Sending…" : ctaLabel}
            </button>
          </form>
        )}
      </section>

      {checkout && <StripeCheckoutModal clientSecret={checkout.clientSecret} publishableKey={checkout.publishableKey} onClose={() => setCheckout(null)} />}
    </main>
  );
}
