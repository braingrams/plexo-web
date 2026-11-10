import type Stripe from "stripe";

import { PLAN_PRICE_ENV, resolvePriceId } from "@/lib/credits/catalog";

// One person, one plan subscription. Changing plan (Pro → Ultra, or back) edits that
// subscription in place and prorates it — it never opens a second one. A second live plan
// subscription is a double charge every month, and this file is what makes it impossible:
//   • changePlanInPlace — used by POST /api/billing/checkout instead of a new Checkout session.
//   • retireSupersededPlanSubscriptions — the Stripe webhook's safety net, so even a race
//     (two checkouts opened at once, an old client, a manual Stripe edit) heals itself.
// Stripe is the source of truth here, not the User row: the row can lag or, as it once did,
// be overwritten by an old subscription's renewal.

export type PaidPlan = "PRO" | "ULTRA";

const PLAN_RANK: Record<PaidPlan, number> = { PRO: 1, ULTRA: 2 };
const LIVE_STATUSES = new Set<Stripe.Subscription.Status>(["active", "trialing", "past_due"]);

/** A Plexo plan subscription (not a funnel add-on slot, not anything else on the customer). */
export function subscriptionPlan(sub: Stripe.Subscription): PaidPlan | null {
  if (sub.metadata?.kind === "lms_addon_slot") return null;
  const plan = sub.metadata?.plan;
  return plan === "PRO" || plan === "ULTRA" ? plan : null;
}

/** Every live plan subscription on the customer, newest first. */
export async function listLivePlanSubscriptions(stripe: Stripe, customerId: string): Promise<Stripe.Subscription[]> {
  const found: Stripe.Subscription[] = [];
  for await (const sub of stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })) {
    if (LIVE_STATUSES.has(sub.status) && subscriptionPlan(sub)) found.push(sub);
  }
  return found.sort((a, b) => b.created - a.created);
}

export class PlanChangeError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "PlanChangeError";
    this.status = status;
  }
}

export type PlanChangeResult = { changed: true; plan: PaidPlan; subscriptionId: string; message: string };

/**
 * Moves the customer's existing plan subscription to `plan`. Returns null when they have no
 * live plan subscription (the caller then starts a normal Checkout). An upgrade is charged
 * right away for the difference only; a downgrade credits the unused time to the next bill.
 */
export async function changePlanInPlace(stripe: Stripe, customerId: string, plan: PaidPlan): Promise<PlanChangeResult | null> {
  const live = await listLivePlanSubscriptions(stripe, customerId);
  if (live.length === 0) return null;

  // Prefer the newest; any older duplicates are retired by the webhook once this one updates.
  const current = live[0];
  const currentPlan = subscriptionPlan(current)!;
  if (currentPlan === plan) {
    throw new PlanChangeError(`You're already on the ${plan === "PRO" ? "Pro" : "Ultra"} plan.`);
  }
  const item = current.items.data[0];
  if (!item) throw new PlanChangeError("We couldn't find your current plan to change. Please contact support.", 409);

  const upgrading = PLAN_RANK[plan] > PLAN_RANK[currentPlan];
  const label = plan === "PRO" ? "Pro" : "Ultra";
  try {
    const updated = await stripe.subscriptions.update(current.id, {
      items: [{ id: item.id, price: resolvePriceId(PLAN_PRICE_ENV[plan]) }],
      metadata: { ...current.metadata, plan },
      cancel_at_period_end: false,
      // Upgrade: bill the prorated difference now. Downgrade: credit the unused time.
      proration_behavior: upgrading ? "always_invoice" : "create_prorations",
      // If the card is declined, nothing changes — the plan never moves without payment.
      payment_behavior: "error_if_incomplete",
    });
    return {
      changed: true,
      plan,
      subscriptionId: updated.id,
      message: upgrading
        ? `You're on ${label} now. You only paid the difference for the rest of this month.`
        : `You'll move to ${label}. The unused time on your old plan is credited to your next bill.`,
    };
  } catch (err) {
    const stripeErr = err as { type?: string; message?: string };
    if (stripeErr?.type === "StripeCardError") {
      throw new PlanChangeError(`Your card was declined, so your plan wasn't changed. ${stripeErr.message ?? ""}`.trim(), 402);
    }
    throw err;
  }
}

/**
 * Safety net: a customer must never keep two live plan subscriptions. Keeps the newest and
 * cancels the rest, crediting their unused time. Returns the ids it cancelled. Best-effort —
 * the caller (a webhook whose event is already claimed) must not fail on a Stripe hiccup.
 */
export async function retireSupersededPlanSubscriptions(stripe: Stripe, customerId: string): Promise<string[]> {
  const live = await listLivePlanSubscriptions(stripe, customerId);
  const [, ...older] = live;
  const cancelled: string[] = [];
  for (const sub of older) {
    try {
      await stripe.subscriptions.cancel(sub.id, { prorate: true, invoice_now: true });
      cancelled.push(sub.id);
      console.warn(`cancelled superseded plan subscription ${sub.id} for customer ${customerId} (kept ${live[0].id})`);
    } catch (err) {
      console.error(`could not cancel superseded plan subscription ${sub.id}`, err);
    }
  }
  return cancelled;
}
