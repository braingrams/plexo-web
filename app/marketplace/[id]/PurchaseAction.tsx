"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripePromise } from "@/lib/stripeClientPromise";

/** The card-entry step renders here, in-page, instead of redirecting to checkout.stripe.com
 * — Stripe still navigates to `return_url` once payment completes (see the purchase route's
 * own comment), which is what lands back on this same marketplace page with ?purchase=success. */
function CheckoutModal({ clientSecret, onClose }: { clientSecret: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-8 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg bg-black/5 text-black/60 hover:bg-black/10"
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

export function PurchaseAction({
  templateId,
  isFree,
  owned,
  isLoggedIn,
  autoUse = false,
}: {
  templateId: string;
  isFree: boolean;
  owned: boolean;
  isLoggedIn: boolean;
  /** Auto-continue into the editor once, right after a successful Stripe redirect back here. */
  autoUse?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(autoUse);
  const [error, setError] = useState<string | null>(null);
  const [checkoutSecret, setCheckoutSecret] = useState<string | null>(null);
  const autoUseFired = useRef(false);

  async function useTemplate() {
    const res = await fetch(`/api/v1/marketplace/templates/${templateId}/use`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to create your copy.");
      setPending(false);
      return;
    }
    router.push(`/dashboard/templates/${data.template.id}`);
  }

  useEffect(() => {
    if (!autoUse || !owned || autoUseFired.current) return;
    autoUseFired.current = true;
    void useTemplate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoUse, owned]);

  async function handleClick() {
    setError(null);

    if (!isLoggedIn) {
      router.push(`/auth/login?redirectTo=${encodeURIComponent(`/marketplace/${templateId}`)}`);
      return;
    }

    setPending(true);

    if (owned) {
      await useTemplate();
      return;
    }

    if (isFree) {
      const res = await fetch(`/api/v1/marketplace/templates/${templateId}/purchase`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to claim template.");
        setPending(false);
        return;
      }
      await useTemplate();
      return;
    }

    const res = await fetch(`/api/v1/marketplace/templates/${templateId}/purchase`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to start checkout.");
      setPending(false);
      return;
    }
    if (data.clientSecret) {
      setCheckoutSecret(data.clientSecret);
      setPending(false);
      return;
    }
    // alreadyOwned raced in between page load and click — just use it.
    await useTemplate();
  }

  return (
    <div>
      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
      <button
        onClick={handleClick}
        disabled={pending}
        className="rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/30 hover:bg-violet-500 hover:scale-105 transition-all disabled:opacity-50"
      >
        {pending ? "Working…" : owned ? "Use this template" : isFree ? "Get this template" : "Buy this template"}
      </button>
      {checkoutSecret && <CheckoutModal clientSecret={checkoutSecret} onClose={() => setCheckoutSecret(null)} />}
    </div>
  );
}
