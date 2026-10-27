import type Stripe from "stripe";
import { TOPUP_PACKS, resolvePriceId } from "./catalog";
import { creditsForTopupPayment } from "./value";

export type TopupPackId = keyof typeof TOPUP_PACKS;
export type TopupOffer = { pack: TopupPackId; priceId: string; amountMinor: number; currency: string; credits: number; price: string };

function formatPrice(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: amountMinor % 100 ? 2 : 0 }).format(amountMinor / 100);
}

/** What a pack costs (from its Stripe price) and the credits it grants: half the price as AI
 *  value (lib/credits/value.ts). Throws if the price isn't a fixed USD amount — credits are
 *  defined in dollars, so any other currency needs a conversion decided first. */
export async function topupOffer(stripe: Stripe, pack: TopupPackId): Promise<TopupOffer> {
  const priceId = resolvePriceId(TOPUP_PACKS[pack].priceEnv);
  const price = await stripe.prices.retrieve(priceId);
  if (price.unit_amount == null || price.currency !== "usd") {
    throw new Error(`Top-up price for ${pack} must be a fixed USD amount (got ${price.currency}).`);
  }
  return { pack, priceId, amountMinor: price.unit_amount, currency: price.currency, credits: creditsForTopupPayment(price.unit_amount / 100), price: formatPrice(price.unit_amount, price.currency) };
}

/** Credits for a completed top-up, from what Stripe actually charged before tax (so discounts
 *  lower it and tax never raises it). Null when it can't be worked out from the session. */
export function creditsForCompletedTopup(session: Stripe.Checkout.Session): number | null {
  if (session.currency !== "usd" || session.amount_total == null) return null;
  const paidMinor = session.amount_total - (session.total_details?.amount_tax ?? 0);
  return paidMinor > 0 ? creditsForTopupPayment(paidMinor / 100) : null;
}
