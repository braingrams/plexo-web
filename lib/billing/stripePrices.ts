import type Stripe from "stripe";

import { PLAN_LABELS, type PaidPlanId } from "@/lib/plan/plans";
import { planPriceMinor, stripeLookupKey, stripeProductId, type BillingInterval, type PriceGroup } from "./pricing";

// Stripe prices for plans are made on demand from the price book: one Product per plan (custom
// id, e.g. plexo_plan_starter) and one Price per plan/interval/currency/amount, found again by
// its lookup key. An admin price edit simply makes a new Price the next time someone checks
// out; subscribers on the old Price keep it. Nothing to set up in Stripe by hand.

const priceCache = new Map<string, string>();

async function ensureProduct(stripe: Stripe, plan: PaidPlanId): Promise<string> {
  const id = stripeProductId(plan);
  try {
    const product = await stripe.products.retrieve(id);
    if (!product.active) await stripe.products.update(id, { active: true });
    return id;
  } catch (err) {
    if ((err as { code?: string })?.code !== "resource_missing") throw err;
  }
  try {
    await stripe.products.create({ id, name: `Plexo ${PLAN_LABELS[plan]}`, metadata: { plexoPlan: plan } });
  } catch (err) {
    // Made a moment ago by another request — fine.
    if ((err as { code?: string })?.code !== "resource_already_exists") throw err;
  }
  return id;
}

/** The Stripe Price id for a plan at the group's current price, creating it the first time. */
export async function ensureStripePlanPrice(stripe: Stripe, region: PriceGroup, plan: PaidPlanId, interval: BillingInterval): Promise<string> {
  const amountMinor = planPriceMinor(region, plan, interval);
  const lookupKey = stripeLookupKey(plan, interval, region.currency, amountMinor);
  const cached = priceCache.get(lookupKey);
  if (cached) return cached;
  const { data } = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (data[0]) {
    priceCache.set(lookupKey, data[0].id);
    return data[0].id;
  }
  const product = await ensureProduct(stripe, plan);
  const price = await stripe.prices.create({
    product,
    currency: region.currency.toLowerCase(),
    unit_amount: amountMinor,
    recurring: { interval: interval === "yearly" ? "year" : "month" },
    lookup_key: lookupKey,
    // Two checkouts racing: the second takes over the key instead of failing.
    transfer_lookup_key: true,
    nickname: `${PLAN_LABELS[plan]} ${interval} ${region.currency}`,
    metadata: { plexoPlan: plan, planVersion: "2", interval },
  });
  priceCache.set(lookupKey, price.id);
  return price.id;
}
