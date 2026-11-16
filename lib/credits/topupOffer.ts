import type Stripe from "stripe";
import { creditsForTopupAmount, regionById, regionForCurrency, topupPack, type PriceBook, type PriceRegion, type TopupPackId, type TopupPackView } from "@/lib/billing/pricing";

export type { TopupPackId };
export type TopupOffer = TopupPackView;

/** What a pack costs in the person's price group and the credits it grants (flat rate — lib/billing/pricing.ts). */
export function topupOffer(region: PriceRegion, pack: TopupPackId): TopupOffer {
  return topupPack(region, pack);
}

/**
 * Credits for a completed Stripe top-up, from what was actually charged before tax (so a
 * discount lowers it and tax never raises it), at the rate it was SOLD at: the session
 * carries the quoted credits and list amount, so a price edit in admin between checkout and
 * payment can't change what an already-paid top-up grants. Older sessions without those fall
 * back to the group's current rate. Null when it can't be worked out.
 */
export function creditsForCompletedTopup(session: Stripe.Checkout.Session, book: PriceBook): number | null {
  if (session.amount_total == null || !session.currency) return null;
  const paidMinor = session.amount_total - (session.total_details?.amount_tax ?? 0);
  if (paidMinor <= 0) return null;
  const quoted = Number(session.metadata?.credits ?? 0);
  const listMinor = Number(session.metadata?.amountMinor ?? 0);
  if (quoted > 0 && listMinor > 0) return Math.round((quoted * Math.min(paidMinor, listMinor)) / listMinor);
  const region = regionById(book, session.metadata?.region) ?? regionForCurrency(book, session.currency);
  return region ? creditsForTopupAmount(paidMinor / 100, session.currency, region) : null;
}
