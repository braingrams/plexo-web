// Which price list an account sees and pays. The country comes, in order, from:
//   1. user.country — the one the owner chose themselves (sign-up, the dashboard prompt, profile);
//   2. billingCountry — saved at their first checkout (older accounts);
//   3. CloudFront-Viewer-Country (forwarded by the ALL_VIEWER_EXCEPT_HOST_HEADER origin request
//      policy in cdk/lib/compute-stack.ts) — only a guess for visitors with nothing set, and used to
//      pre-select the country dropdown.
// While a subscription is running, billingCountry stays in charge so the price can't change
// mid-plan; a new country takes effect once the plan ends. Which group a country belongs to,
// and its prices, come from the price book (lib/billing/priceBook.ts).

import { effectiveCountry, pricingView, resolvePriceRegion, type PriceBook, type PriceGroup, type PricingView } from "./pricing";

export type BillingRegionUser = {
  country?: string | null;
  billingCountry?: string | null;
  billingCurrency?: string | null;
  billingRegionLockedAt?: string | null;
  subscriptionProvider?: string | null;
  subscriptionId?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: string | null;
};

/** The viewer's country from the edge headers (CloudFront, or Vercel for previews); BILLING_DEV_COUNTRY in local dev. */
export function countryFromHeaders(headers: Headers): string | null {
  const dev = process.env.NODE_ENV !== "production" ? process.env.BILLING_DEV_COUNTRY : undefined;
  return headers.get("cloudfront-viewer-country") ?? headers.get("x-vercel-ip-country") ?? dev ?? null;
}

/** A subscription that's still running fixes the currency (you can't pay half in naira, half in dollars). */
export function hasRunningSubscription(user: BillingRegionUser | null | undefined): boolean {
  if (!user) return false;
  const ref = user.subscriptionId || user.stripeSubscriptionId;
  return !!ref && user.subscriptionStatus !== "CANCELED";
}

function regionInput(user: BillingRegionUser | null | undefined, headers: Headers) {
  // A Stripe subscription from before regional pricing is a USD subscription.
  const legacyUsd = !user?.billingCurrency && !!user?.stripeSubscriptionId && user?.subscriptionProvider !== "PAYSTACK" && hasRunningSubscription(user);
  const keepsPaidCountry = hasRunningSubscription(user) && !!user?.billingCountry;
  return {
    userCountry: keepsPaidCountry ? null : user?.country,
    headerCountry: countryFromHeaders(headers),
    billingCountry: user?.billingCountry,
    // Prices are always in the owner's country currency. A saved "USD" only counts while a subscription is running in it
    // (it fixes the currency); once that ends, people are back on their own country's price list.
    billingCurrency: legacyUsd ? "USD" : hasRunningSubscription(user) ? user?.billingCurrency : undefined,
  };
}

export function billingRegionFor(book: PriceBook, user: BillingRegionUser | null | undefined, headers: Headers): PriceGroup {
  return resolvePriceRegion(book, regionInput(user, headers));
}

/** Everything a pricing screen needs, for this account on this request. */
export function pricingViewFor(book: PriceBook, user: BillingRegionUser | null | undefined, headers: Headers): PricingView {
  const input = regionInput(user, headers);
  return pricingView(resolvePriceRegion(book, input), { choices: null, locked: hasRunningSubscription(user), country: effectiveCountry(input) });
}

/** The fields to save on the account the first time it checks out (null once saved). */
export function regionLockFields(user: BillingRegionUser, region: PriceGroup, headers: Headers, now = new Date()): Record<string, string> | null {
  if (user.billingRegionLockedAt && user.billingCountry) return null;
  const country = regionInput(user, headers);
  const picked = effectiveCountry(country) ?? undefined;
  return {
    ...(picked ? { billingCountry: picked } : {}),
    billingCurrency: region.currency,
    billingRegion: region.id,
    billingRegionLockedAt: now.toISOString(),
  };
}
