import type Stripe from "stripe";

import { CURRENT_PLAN_VERSION, normalizeStoredPlan, type PaidPlanId, PLAN } from "@/lib/plan/plans";

/**
 * The Plexo plan a Stripe subscription is for, in today's terms — or null when it isn't a
 * plan subscription (a funnel add-on slot, anything else on the customer).
 *
 * Subscriptions created before the 2026 rename carry metadata.plan "PRO"/"ULTRA" with no
 * metadata.planVersion: those read as STARTER/PRO, forever — a renewal of an old Pro
 * subscription can never turn an account into today's Pro. New subscriptions carry
 * planVersion "2" (stripePlanMetadata).
 */
export function planFromStripeSubscription(sub: Pick<Stripe.Subscription, "metadata">): PaidPlanId | null {
  if (sub.metadata?.kind === "lms_addon_slot") return null;
  const raw = sub.metadata?.plan;
  if (!raw) return null;
  const plan = normalizeStoredPlan(raw, sub.metadata?.planVersion);
  return plan === PLAN.FREE ? null : plan;
}

/** Metadata every new plan subscription carries. */
export function stripePlanMetadata(input: { plexoUserId: string; plan: PaidPlanId; interval: string; region: string }): Record<string, string> {
  return {
    plexoUserId: input.plexoUserId,
    plan: input.plan,
    planVersion: String(CURRENT_PLAN_VERSION),
    interval: input.interval,
    region: input.region,
  };
}
