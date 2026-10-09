import { creditUsdValue } from "./pricing";
import type { SubscriptionPlan } from "@/lib/subscription";

/**
 * How much AI each plan and each credit purchase is worth — THE reference for every credit
 * amount Plexo grants. Credit amounts are never hard-coded anywhere else; they're derived
 * from the dollar values here.
 *
 * The calculation
 * ───────────────
 *   credits = AI dollars ÷ CREDIT_USD_VALUE
 *
 * CREDIT_USD_VALUE (lib/credits/pricing.ts) is the dollar value of one credit: $0.001 by
 * default, i.e. 1,000 credits = $1 of AI. Usage is charged against the same rate (a call that
 * costs the provider $0.012 costs 12 credits), so a credit always means the same thing.
 *
 * Monthly allowance (granted each 30-day period, not rolled over — lib/db/ledgerOperations.ts):
 *
 *   Plan    AI value / month   Credits / month (at $0.001)
 *   FREE    $0.10              0.10 ÷ 0.001 =   100
 *   PRO     $2.00              2.00 ÷ 0.001 = 2,000
 *   ULTRA   $3.00              3.00 ÷ 0.001 = 3,000
 *
 * Credit top-ups (add-ons): half of what the customer pays becomes AI value.
 *
 *   credits = (amount paid in USD × 0.5) ÷ CREDIT_USD_VALUE
 *   e.g. $20 paid → $10 of AI → 10 ÷ 0.001 = 10,000 credits
 *        $5 paid  → $2.50     →  2,500 credits
 *
 * The amount paid is what Stripe actually charged for the pack, before tax (so a discount
 * lowers the credits proportionally and tax never inflates them) — see creditsForTopupPayment.
 *
 * Changing a value here changes what every new period and every new purchase grants; it never
 * alters credits already granted.
 */
export const PLAN_MONTHLY_AI_USD: Record<SubscriptionPlan, number> = {
  FREE: 0.1,
  PRO: 2,
  ULTRA: 3,
};

/** Share of a top-up's price that becomes AI credits. */
export const TOPUP_AI_SHARE = 0.5;

/** Whole credits for a dollar amount. Rounded (not ceiled like usage charges) so float noise
 *  (e.g. 0.05 / 0.001 = 50.000000000000004) never adds a stray credit. */
function grantCreditsForUsd(usd: number): number {
  return Math.max(0, Math.round(usd / creditUsdValue()));
}

/** Credits a plan grants each month: its AI dollar value at the current credit rate. */
export function planMonthlyCredits(plan: SubscriptionPlan): number {
  return grantCreditsForUsd(PLAN_MONTHLY_AI_USD[plan] ?? PLAN_MONTHLY_AI_USD.FREE);
}

/** Credits a top-up grants for what was paid (USD, before tax): half of it, at the current rate. */
export function creditsForTopupPayment(amountPaidUsd: number): number {
  return grantCreditsForUsd(amountPaidUsd * TOPUP_AI_SHARE);
}
