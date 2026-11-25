import { creditUsdValue } from "./pricing";
import type { SubscriptionPlan } from "@/lib/subscription";
import { toPlanId } from "@/lib/plan/plans";

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
 *   Plan        AI value / month   Credits / month (at $0.001)
 *   FREE        $0.20                200
 *   STARTER     $1.00              1,000
 *   PRO         $2.00              2,000
 *   ENTERPRISE  $3.00              3,000
 *
 * The free trial adds no AI credits: a trial account keeps the Free allowance.
 *
 * Credit top-ups (add-ons) are a flat rate: $1 per 1,000 credits (₦1,500 per 1,000 in
 * Nigeria; each region's rate is in lib/billing/pricing.ts topupPer1000Credits). The credits
 * granted come from what was actually paid before tax (creditsForTopupAmount), so a discount
 * lowers them proportionally and tax never inflates them.
 *
 * Changing a value here changes what every new period and every new purchase grants; it never
 * alters credits already granted.
 */
export const PLAN_MONTHLY_AI_USD: Record<SubscriptionPlan, number> = {
  FREE: 0.2,
  STARTER: 1,
  PRO: 2,
  ENTERPRISE: 3,
};

/**
 * The one-time "first site" grant: AI value given once to every Free account, on top of the
 * monthly allowance, so building and polishing a first website never hits a paywall. It lands
 * in the top-up bucket (it doesn't expire or reset), covers the template personalize / first
 * generation and a round of follow-up edits, and can only ever be granted once per account.
 * $0.60 ≈ 600 credits at the default rate.
 */
export const FIRST_SITE_GRANT_USD = 0.6;

/** Credits in the one-time first-site grant. */
export function firstSiteGrantCredits(): number {
  return grantCreditsForUsd(FIRST_SITE_GRANT_USD);
}

/** Whole credits for a dollar amount. Rounded (not ceiled like usage charges) so float noise
 *  (e.g. 0.05 / 0.001 = 50.000000000000004) never adds a stray credit. */
function grantCreditsForUsd(usd: number): number {
  return Math.max(0, Math.round(usd / creditUsdValue()));
}

/** Credits a plan grants each month: its AI dollar value at the current credit rate. Accepts the retired ULTRA (= PRO). */
export function planMonthlyCredits(plan: SubscriptionPlan | string | null | undefined): number {
  return grantCreditsForUsd(PLAN_MONTHLY_AI_USD[toPlanId(plan)]);
}
