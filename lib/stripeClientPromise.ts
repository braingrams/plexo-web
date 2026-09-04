"use client";

import { loadStripe, type Stripe } from "@stripe/stripe-js";

/**
 * Plexo's own platform Stripe publishable key (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) — shared
 * by every embedded Checkout on the platform-billing side of the app (plan upgrades/credit
 * top-ups in app/dashboard/settings/billing-section.tsx, marketplace template purchases in
 * app/marketplace/[id]/PurchaseAction.tsx). Not used by Commerce's storefront checkout,
 * which is per-site and can run on a site owner's own BYO Stripe account instead — that
 * flow's card entry happens on Stripe's hosted page, not embedded in the dashboard.
 *
 * loadStripe() is memoized at module scope (not per-render) per Stripe's own guidance, and
 * shared across every caller here so multiple embedded-checkout mount points on the same
 * page don't each fetch Stripe.js separately.
 */
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key ? loadStripe(key) : Promise.resolve(null);
  }
  return stripePromise;
}
