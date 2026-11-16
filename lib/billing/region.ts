// Which price list an account sees and pays — from where the request comes from
// (CloudFront-Viewer-Country, forwarded to the app by the ALL_VIEWER_EXCEPT_HOST_HEADER
// origin request policy in cdk/lib/compute-stack.ts) until the first checkout, then from
// the country saved on the account at that checkout, so prices never flip afterwards. Which
// group a country belongs to, and its prices, come from the price book (lib/billing/priceBook.ts).

import { currencyChoices, pricingView, resolvePriceRegion, type PriceBook, type PriceGroup, type PricingView } from "./pricing";

export type BillingRegionUser = {
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
  return {
    headerCountry: countryFromHeaders(headers),
    billingCountry: user?.billingCountry,
    billingCurrency: legacyUsd ? "USD" : user?.billingCurrency,
  };
}

export function billingRegionFor(book: PriceBook, user: BillingRegionUser | null | undefined, headers: Headers): PriceGroup {
  return resolvePriceRegion(book, regionInput(user, headers));
}

/** Everything a pricing screen needs, for this account on this request. */
export function pricingViewFor(book: PriceBook, user: BillingRegionUser | null | undefined, headers: Headers): PricingView {
  const input = regionInput(user, headers);
  return pricingView(resolvePriceRegion(book, input), { choices: currencyChoices(book, input), locked: hasRunningSubscription(user) });
}

/** The fields to save on the account the first time it checks out (null once saved). */
export function regionLockFields(user: BillingRegionUser, region: PriceGroup, headers: Headers, now = new Date()): Record<string, string> | null {
  if (user.billingRegionLockedAt && user.billingCountry) return null;
  const country = user.billingCountry ?? countryFromHeaders(headers) ?? undefined;
  return {
    ...(country ? { billingCountry: country.toUpperCase() } : {}),
    billingCurrency: region.currency,
    billingRegion: region.id,
    billingRegionLockedAt: now.toISOString(),
  };
}
