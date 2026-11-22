// Custom domains by plan (lib/subscription.ts maxCustomDomains): Free none, Starter 1,
// Pro 3, Enterprise 10 (more on request). During the free trial they wait for the first
// payment. Pure — callers count the account's live custom domains themselves.

import { getTierFeatures } from "@/lib/subscription";
import { planThatRaises } from "./planNeeded";
import { isPaidPlanId, PLAN, toPlanId, type PaidPlanId } from "./plans";

export type DomainActor = { subscriptionPlan: string; onTrial?: boolean };

/**
 * Why connecting (or buying) one more custom domain isn't allowed, or null when it is.
 * `currentCustomCount` = custom domains already connected and not switched off by a downgrade.
 */
export function customDomainError(actor: DomainActor, currentCustomCount: number): string | null {
  const base = getTierFeatures(actor.subscriptionPlan);
  if (!base.customDomainEnabled) {
    return "Custom domains come with the Starter plan and above. Your site can go live on a free Plexo address now, or upgrade in Settings → Billing to use your own domain.";
  }
  if (actor.onTrial) {
    return "Custom domains switch on once your plan is paid for — your trial includes everything else. Choose a plan in Settings → Billing to connect your domain now.";
  }
  if (currentCustomCount >= base.maxCustomDomains) {
    const n = base.maxCustomDomains;
    return `Your plan includes ${n} custom domain${n === 1 ? "" : "s"}, and ${n === 1 ? "it's" : "they're all"} in use. Disconnect one, or upgrade for more (Pro includes 3).`;
  }
  return null;
}

export function countLiveCustomDomains(domains: { type?: string | null; planDisabledAt?: string | null }[]): number {
  return domains.filter((d) => d.type === "CUSTOM" && !d.planDisabledAt).length;
}

/** The plan that lifts customDomainError: Starter for a first domain, the paid version of the current plan on a trial, otherwise the one with more domains. */
export function customDomainRequiredPlan(actor: DomainActor): PaidPlanId {
  const base = getTierFeatures(actor.subscriptionPlan);
  if (!base.customDomainEnabled) return PLAN.STARTER;
  if (actor.onTrial) {
    const current = toPlanId(actor.subscriptionPlan);
    return isPaidPlanId(current) ? current : PLAN.STARTER;
  }
  return planThatRaises((f) => f.maxCustomDomains, base.maxCustomDomains);
}
