"use client";

import { FormEvent, useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { MailCheck, X, CircleCheck } from "lucide-react";
import { AuthShell } from "@/app/auth/_kit/AuthShell";
import { Alert, Button, PageHead } from "@/app/auth/_kit/ui";
import { TextField } from "@/app/auth/_kit/fields";

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
    <div className="ax-modal" onClick={onClose}>
      <div className="ax-modal-box" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ax-modal-close" onClick={onClose} aria-label="Close"><X size={18} aria-hidden="true" /></button>
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
      <AuthShell layout="center">
        <div className="ax-center-text">
          <div className="ax-badge-icon ax-lime"><CircleCheck size={30} aria-hidden="true" /></div>
          <PageHead title="Payment received">We’re setting up your access. Check your email in a moment for your link in.</PageHead>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell layout="center">
      {sent ? (
        <div className="ax-center-text">
          <div className="ax-badge-icon ax-lime"><MailCheck size={30} aria-hidden="true" /></div>
          <PageHead title="Check your email">
            We sent a link to <strong>{email.trim()}</strong>. Click it to start.
          </PageHead>
          <p className="ax-tips">Nothing yet? Check your spam folder, or wait a minute and sign up again.</p>
        </div>
      ) : (
        <>
          <PageHead title={funnelName}>Sign up and we’ll email you a link to get started. No password needed.</PageHead>
          <form onSubmit={onSubmit} noValidate className="ax-stack">
            {error ? <Alert tone="error">{error}</Alert> : null}
            {(meta?.requireName ?? true) && (
              <TextField label="Name" type="text" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            )}
            <TextField label="Email address" type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            {meta?.collectPhone && (
              <TextField label="Phone number" type="tel" autoComplete="tel" optional value={phone} onChange={(e) => setPhone(e.target.value)} />
            )}
            <Button type="submit" loading={loading}>{loading ? "Sending…" : ctaLabel}</Button>
          </form>
        </>
      )}

      {checkout && <StripeCheckoutModal clientSecret={checkout.clientSecret} publishableKey={checkout.publishableKey} onClose={() => setCheckout(null)} />}
    </AuthShell>
  );
}
