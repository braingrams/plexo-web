// What an owner pays at their next renewal, in plain words — for Settings > Plan and the renewal email.

import { loadPriceBook } from "./priceBook";
import { loadPriceChanges } from "./priceChangeStore";
import { nextPriceNotice, priceAtNextRenewal, type NextPrice } from "./priceChanges";
import { toSubscriberInput, type MoveUser } from "./priceMove";
import { formatMinor, type BillingCurrency, type BillingInterval } from "./pricing";

export type OwnerNextPrice = {
  /** "Your price changes to ₦3,500/month on 5 December 2026." or null when nothing is changing. */
  notice: string | null;
  /** What the next renewal charges (minor units), when known. */
  nextAmountMinor: number | null;
  /** What they pay now (minor units), when known. */
  currentAmountMinor: number | null;
  currency: string | null;
  changes: boolean;
  takesEffectAt: string | null;
};

const none: OwnerNextPrice = { notice: null, nextAmountMinor: null, currentAmountMinor: null, currency: null, changes: false, takesEffectAt: null };

export async function ownerNextPrice(user: MoveUser, now: Date = new Date()): Promise<OwnerNextPrice> {
  try {
    const interval: BillingInterval = user.subscriptionInterval === "yearly" ? "yearly" : "monthly";
    const currency = (user.billingCurrency ?? "USD") as BillingCurrency;
    // Already moved: the renewal that charges the new price hasn't happened yet.
    if (user.nextAmountMinor && user.nextAmountAt && Date.parse(user.nextAmountAt) > now.getTime()) {
      const note = `Your price changes to ${formatMinor(user.nextAmountMinor, currency)}/${interval === "yearly" ? "year" : "month"} on ${new Date(user.nextAmountAt).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}.`;
      return { notice: note, nextAmountMinor: user.nextAmountMinor, currentAmountMinor: user.subscriptionAmountMinor ?? null, currency, changes: true, takesEffectAt: user.nextAmountAt };
    }
    const input = toSubscriberInput(user);
    if (!input) return none;
    const [book, changes] = await Promise.all([loadPriceBook(), loadPriceChanges()]);
    const next: NextPrice = priceAtNextRenewal(input, book, changes, now);
    return {
      notice: nextPriceNotice(next, interval),
      nextAmountMinor: next.nextAmount === null ? null : Math.round(next.nextAmount * 100),
      currentAmountMinor: next.currentAmount === null ? null : Math.round(next.currentAmount * 100),
      currency: next.currency,
      changes: next.changes,
      takesEffectAt: next.takesEffectAt,
    };
  } catch (err) {
    console.error("couldn't work out the next renewal price", err);
    return none;
  }
}
