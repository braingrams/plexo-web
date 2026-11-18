"use client";
import { PaidPlanId } from "@/lib/plan/plans";

// One "Upgrade" (or "Buy credits") button for everyone: the server picks Stripe (US dollars) or
// Paystack (naira, cedis, shillings, rand) from the person's region (POST /api/billing/checkout),
// and this turns the answer into something a component can show:
//   • Stripe   → the embedded card form's client secret (render it as before);
//   • Paystack → Paystack's own payment popup opens right here; once it reports success the
//                payment is confirmed with the server (GET /api/billing/paystack/verify) so the
//                new plan or credits show straight away. If the popup can't load (blocked
//                script, very old browser) we fall back to Paystack's payment page, which
//                returns to /dashboard/settings/subscription?paystack=1&reference=…;
//   • an existing plan changed in place → a message.

import type { BillingInterval } from "./pricing";

export type CheckoutBody =
  | { kind: "subscription"; plan: PaidPlanId; interval?: BillingInterval; returnTo?: string }
  | { kind: "topup"; pack: "SMALL" | "MEDIUM" | "LARGE"; stayInPage?: boolean; returnTo?: string }
  | { kind: "funnel_addon_slot"; returnTo?: string };

export type CheckoutResult =
  | { kind: "stripe"; clientSecret: string }
  | { kind: "changed"; message: string }
  | { kind: "paid"; message: string; plan: string | null }
  | { kind: "processing"; message: string }
  | { kind: "redirecting" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

type CheckoutResponse = {
  provider?: "STRIPE" | "PAYSTACK";
  clientSecret?: string;
  changed?: boolean;
  message?: string;
  accessCode?: string;
  authorizationUrl?: string;
  reference?: string;
  error?: string;
};

type PaystackPopInstance = {
  resumeTransaction: (
    accessCode: string,
    callbacks: { onSuccess?: (tx: { reference?: string }) => void; onCancel?: () => void; onError?: (err: unknown) => void },
  ) => void;
};
type PaystackPopCtor = new () => PaystackPopInstance;

const PAYSTACK_INLINE_SRC = "https://js.paystack.co/v2/inline.js";
let paystackScript: Promise<PaystackPopCtor> | null = null;

function loadPaystack(): Promise<PaystackPopCtor> {
  const existing = (window as unknown as { PaystackPop?: PaystackPopCtor }).PaystackPop;
  if (existing) return Promise.resolve(existing);
  if (paystackScript) return paystackScript;
  paystackScript = new Promise<PaystackPopCtor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PAYSTACK_INLINE_SRC;
    script.async = true;
    script.onload = () => {
      const ctor = (window as unknown as { PaystackPop?: PaystackPopCtor }).PaystackPop;
      if (ctor) resolve(ctor);
      else reject(new Error("Paystack didn't load."));
    };
    script.onerror = () => reject(new Error("Paystack didn't load."));
    document.head.appendChild(script);
    // A blocked script never fires either event — don't hang the button forever.
    setTimeout(() => reject(new Error("Paystack took too long to load.")), 15_000);
  }).catch((err) => {
    paystackScript = null;
    throw err;
  });
  return paystackScript;
}

/** Confirms a Paystack payment with the server (and applies it). Used after the popup and on the redirect return. */
export async function verifyPaystackPayment(reference: string): Promise<CheckoutResult> {
  try {
    const res = await fetch(`/api/billing/paystack/verify?reference=${encodeURIComponent(reference)}`, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { status?: string; applied?: string; plan?: string | null; error?: string };
    if (!res.ok) return { kind: "error", message: data.error ?? "We couldn't confirm your payment yet. If you were charged, it will show in a few minutes." };
    if (data.status === "complete") {
      return {
        kind: "paid",
        plan: data.plan ?? null,
        message: data.applied === "topup" ? "Payment received — your credits have been added." : "Payment received — your plan is active now.",
      };
    }
    if (data.status === "abandoned" || data.status === "failed") return { kind: "error", message: "The payment didn't go through, so nothing was charged. Please try again." };
    return { kind: "processing", message: "Your payment is still processing — this page will update once it's confirmed." };
  } catch {
    return { kind: "error", message: "We couldn't confirm your payment yet. If you were charged, it will show in a few minutes." };
  }
}

function openPaystackPopup(accessCode: string, authorizationUrl: string | undefined): Promise<CheckoutResult> {
  return loadPaystack()
    .then(
      (PaystackPop) =>
        new Promise<CheckoutResult>((resolve) => {
          const popup = new PaystackPop();
          popup.resumeTransaction(accessCode, {
            onSuccess: (tx) => {
              if (!tx?.reference) {
                resolve({ kind: "processing", message: "Payment received — your account will update in a moment." });
                return;
              }
              void verifyPaystackPayment(tx.reference).then(resolve);
            },
            onCancel: () => resolve({ kind: "cancelled" }),
            onError: () => resolve({ kind: "error", message: "The payment window had a problem. Nothing was charged — please try again." }),
          });
        }),
    )
    .catch((): CheckoutResult => {
      if (authorizationUrl) {
        window.location.href = authorizationUrl;
        return { kind: "redirecting" };
      }
      return { kind: "error", message: "The payment window couldn't open. Please check your connection and try again." };
    });
}

/** Starts a checkout for a plan, credits or a funnel slot, whichever provider the person pays with. */
export async function startCheckout(body: CheckoutBody): Promise<CheckoutResult> {
  let data: CheckoutResponse;
  try {
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    data = (await res.json().catch(() => ({}))) as CheckoutResponse;
    if (!res.ok) return { kind: "error", message: data.error ?? "We couldn't start the payment. Please try again." };
  } catch {
    return { kind: "error", message: "We couldn't reach Plexo. Please check your connection and try again." };
  }
  if (data.changed) return { kind: "changed", message: data.message ?? "Your plan is updating now." };
  if (data.provider === "PAYSTACK" && data.accessCode) return openPaystackPopup(data.accessCode, data.authorizationUrl);
  if (data.clientSecret) return { kind: "stripe", clientSecret: data.clientSecret };
  return { kind: "error", message: data.error ?? "We couldn't start the payment. Please try again." };
}
