// "Upgrade for more credits": the next plan whose monthly AI allowance is bigger than the one
// the account gets now. The amounts come from lib/credits/value.ts (never typed here). A free
// trial adds no AI credits (allowancePlan), so this offer is always a paid upgrade, never a trial.

import { PAID_PLAN_IDS, PLAN_RANK, toPlanId, type PaidPlanId } from "@/lib/plan/plans";
import { planMonthlyCredits } from "./value";

export type CreditUpgradeOffer = { plan: PaidPlanId; credits: number; currentCredits: number };

/** The cheapest paid plan that grants more credits each month than `currentPlan` does, or null when none does. */
export function creditUpgradeOffer(currentPlan: string | null | undefined): CreditUpgradeOffer | null {
  const current = toPlanId(currentPlan);
  const currentCredits = planMonthlyCredits(current);
  const next = PAID_PLAN_IDS.find((p) => PLAN_RANK[p] > PLAN_RANK[current] && planMonthlyCredits(p) > currentCredits);
  return next ? { plan: next, credits: planMonthlyCredits(next), currentCredits } : null;
}

/** "Pro adds 2,000 credits a month (you get 200 now)." */
export function creditUpgradeLine(offer: CreditUpgradeOffer, planName: string): string {
  return `${planName} gives you ${offer.credits.toLocaleString("en-US")} credits every month (you get ${offer.currentCredits.toLocaleString("en-US")} now).`;
}

// ── The out-of-credits answer for API / MCP / SOL clients ────────────────────────────────

const OUT_OF_CREDITS_TEXT = /enough AI credits|out of AI credits|used all your AI credits|insufficient_credits/i;

/** The three ways forward, as paths on the app (relative; the dashboard adds the origin). */
export const OUT_OF_CREDITS_LINKS = {
  topUpUrl: "/dashboard/settings/subscription?topup=1",
  ownKeyUrl: "/dashboard/settings/ai",
  upgradeUrl: "/dashboard/settings/subscription",
} as const;

/** An AI refusal as a response body: when it is the "out of credits" one it carries a stable code and the three ways forward, so an assistant can say them to the owner. */
export function aiRefusalBody(refusal: { error: string; status: number }): Record<string, unknown> {
  if (refusal.status === 402 && OUT_OF_CREDITS_TEXT.test(refusal.error)) {
    return { error: refusal.error, code: "OUT_OF_CREDITS", ...OUT_OF_CREDITS_LINKS };
  }
  return { error: refusal.error };
}

/** The same, as a sentence for text-only places (MCP tool errors, WhatsApp). */
export function outOfCreditsSentence(baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io").replace(/\/$/, "")): string {
  return `You're out of AI credits. Top up: ${baseUrl}${OUT_OF_CREDITS_LINKS.topUpUrl} · Use your own AI key: ${baseUrl}${OUT_OF_CREDITS_LINKS.ownKeyUrl} · Or upgrade for more every month: ${baseUrl}${OUT_OF_CREDITS_LINKS.upgradeUrl}`;
}
