// The 2026 plan move: old PRO → STARTER, old ULTRA → PRO (lib/plan/plans.ts).
//
// For each account written before the rename (planVersion missing):
//   1. The User row is rewritten in today's terms (subscriptionPlan, pendingPlan,
//      planBeforeDowngrade) with planVersion 2. Features don't change: the new plan unlocks
//      exactly what the old one did (the code already reads unmigrated rows this way).
//   2. A live Stripe plan subscription keeps its current price until its period ends, then
//      moves to the new plan's price from the price book — a Stripe subscription schedule
//      with two phases, no proration, no charge today. The account shows "from your next
//      renewal on … you'll be on Starter at $9" (User.scheduledPlan/scheduledPlanAt).
//   3. Optionally (--notify) the owner gets one email explaining it.
//
// Idempotent: a row already at planVersion 2 is skipped; a subscription that already has a
// schedule with our phase (metadata.planVersion "2") is left alone. Dry run by default.
// Deps are injected so this is testable without DynamoDB or Stripe.

import type Stripe from "stripe";

import { mapLegacyPlan, CURRENT_PLAN_VERSION, PLAN_LABELS, type PaidPlanId, type PlanId } from "@/lib/plan/plans";
import { formatMoney, planPrice, resolvePriceRegion, usdAlternative, type BillingInterval, type PriceBook, type PriceGroup } from "./pricing";
import { stripePlanMetadata } from "./stripePlans";

export type LegacyUser = {
  id: string;
  email: string;
  subscriptionPlan?: string | null;
  planVersion?: number | null;
  pendingPlan?: string | null;
  planBeforeDowngrade?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: string | null;
  country?: string | null;
  billingCountry?: string | null;
  billingCurrency?: string | null;
};

export type UserRewrite = {
  subscriptionPlan: PlanId;
  planVersion: number;
  pendingPlan?: PaidPlanId;
  planBeforeDowngrade?: PaidPlanId;
};

/** The User fields to rewrite, or null when the row is already in today's terms. */
export function userRewrite(user: LegacyUser): UserRewrite | null {
  if ((user.planVersion ?? 0) >= CURRENT_PLAN_VERSION) return null;
  const out: UserRewrite = { subscriptionPlan: mapLegacyPlan(user.subscriptionPlan ?? "FREE"), planVersion: CURRENT_PLAN_VERSION };
  const pending = user.pendingPlan ? mapLegacyPlan(user.pendingPlan) : null;
  if (pending && pending !== "FREE") out.pendingPlan = pending;
  const before = user.planBeforeDowngrade ? mapLegacyPlan(user.planBeforeDowngrade) : null;
  if (before && before !== "FREE") out.planBeforeDowngrade = before;
  return out;
}

/** The USD price group an existing Stripe subscriber moves to (Stripe charges in USD for them). */
export function stripeGroupFor(book: PriceBook, country: string | null | undefined): PriceGroup {
  const own = resolvePriceRegion(book, { billingCountry: country });
  if (own.provider === "STRIPE" && own.currency === "USD") return own;
  return usdAlternative(book, country) ?? resolvePriceRegion(book, {});
}

export type MigrationDeps = {
  apply: boolean;
  notify: boolean;
  book: PriceBook;
  listUsers: () => AsyncIterable<LegacyUser>;
  /** Writes the rewrite only if the row is still unmigrated (conditional). Returns false if it already was. */
  patchUser: (id: string, fields: Record<string, unknown>, onlyIfUnmigrated: boolean) => Promise<boolean>;
  stripe: Pick<Stripe, "subscriptions" | "subscriptionSchedules" | "customers"> | null;
  ensurePrice: (group: PriceGroup, plan: PaidPlanId, interval: BillingInterval) => Promise<string>;
  sendEmail?: (user: LegacyUser, input: { oldPlanName: string; newPlan: PaidPlanId; renewsAt: string | null; newPrice: string | null }) => Promise<void>;
  log: (line: string) => void;
};

export type MigrationReport = { scanned: number; rewritten: number; alreadyDone: number; scheduled: number; scheduleSkipped: number; failed: number; emailed: number };

const LIVE = new Set(["active", "trialing", "past_due"]);

export async function runPlanMigration(deps: MigrationDeps): Promise<MigrationReport> {
  const r: MigrationReport = { scanned: 0, rewritten: 0, alreadyDone: 0, scheduled: 0, scheduleSkipped: 0, failed: 0, emailed: 0 };
  for await (const user of deps.listUsers()) {
    r.scanned++;
    const rewrite = userRewrite(user);
    if (!rewrite) {
      r.alreadyDone++;
      continue;
    }
    const oldName = user.subscriptionPlan === "ULTRA" ? "Ultra" : user.subscriptionPlan === "PRO" ? "Pro" : "Free";
    try {
      let schedule: { renewsAt: string; price: string; group: PriceGroup; plan: PaidPlanId } | null = null;
      if (deps.stripe && user.stripeSubscriptionId && rewrite.subscriptionPlan !== "FREE") {
        schedule = await scheduleStripeMove(deps, user, rewrite.subscriptionPlan as PaidPlanId, r);
      }
      const fields: Record<string, unknown> = { ...rewrite };
      if (schedule) {
        fields.scheduledPlan = schedule.plan;
        fields.scheduledPlanAt = schedule.renewsAt;
        fields.billingRegion = schedule.group.id;
        if (!user.billingCurrency) fields.billingCurrency = "USD";
      }
      deps.log(`${deps.apply ? "rewrite" : "would rewrite"} ${user.email}: ${user.subscriptionPlan ?? "FREE"} → ${rewrite.subscriptionPlan}${schedule ? ` (renews ${schedule.renewsAt.slice(0, 10)} at ${schedule.price})` : ""}`);
      if (deps.apply) {
        const wrote = await deps.patchUser(user.id, fields, true);
        if (!wrote) {
          r.alreadyDone++;
          continue;
        }
      }
      r.rewritten++;
      if (deps.notify && deps.sendEmail && rewrite.subscriptionPlan !== "FREE" && deps.apply) {
        await deps.sendEmail(user, { oldPlanName: oldName, newPlan: rewrite.subscriptionPlan as PaidPlanId, renewsAt: schedule?.renewsAt ?? null, newPrice: schedule?.price ?? null });
        r.emailed++;
      }
    } catch (err) {
      r.failed++;
      deps.log(`FAILED ${user.email}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return r;
}

async function scheduleStripeMove(
  deps: MigrationDeps,
  user: LegacyUser,
  plan: PaidPlanId,
  r: MigrationReport,
): Promise<{ renewsAt: string; price: string; group: PriceGroup; plan: PaidPlanId } | null> {
  const stripe = deps.stripe!;
  const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId!);
  if (!LIVE.has(sub.status) || sub.cancel_at_period_end) {
    r.scheduleSkipped++;
    return null;
  }
  const item = sub.items.data[0];
  const periodEnd = item?.current_period_end;
  if (!item || !periodEnd) {
    r.scheduleSkipped++;
    return null;
  }
  const interval: BillingInterval = item.price?.recurring?.interval === "year" ? "yearly" : "monthly";
  let country = user.billingCountry ?? user.country ?? null;
  if (!country && typeof sub.customer === "string") {
    const customer = await stripe.customers.retrieve(sub.customer);
    country = customer.deleted ? null : (customer.address?.country ?? null);
  }
  const group = stripeGroupFor(deps.book, country);
  const renewsAt = new Date(periodEnd * 1000).toISOString();
  const amount = planPrice(group, plan, interval);
  if (amount === null) {
    // Yearly was switched off for this plan: no yearly price to move them to — left as they are.
    deps.log(`  ${user.email}: ${PLAN_LABELS[plan]} isn't offered ${interval} any more — left on their current price, check by hand`);
    r.scheduleSkipped++;
    return null;
  }
  const price = `${formatMoney(amount, group.currency)}/${interval === "yearly" ? "year" : "month"}`;

  const existingScheduleId = typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id;
  if (existingScheduleId) {
    const existing = await stripe.subscriptionSchedules.retrieve(existingScheduleId);
    if (existing.phases.some((p) => p.metadata?.planVersion === String(CURRENT_PLAN_VERSION))) {
      r.scheduleSkipped++;
      return { renewsAt, price, group, plan };
    }
    deps.log(`  ${user.email}: subscription already has a different schedule (${existingScheduleId}) — left alone, check by hand`);
    r.scheduleSkipped++;
    return null;
  }

  if (!deps.apply) {
    deps.log(`  would schedule ${sub.id}: keep ${item.price?.id} until ${renewsAt.slice(0, 10)}, then ${PLAN_LABELS[plan]} ${price} (${group.name})`);
    r.scheduled++;
    return { renewsAt, price, group, plan };
  }

  const newPriceId = await deps.ensurePrice(group, plan, interval);
  const schedule = await stripe.subscriptionSchedules.create({ from_subscription: sub.id });
  const current = schedule.phases[0];
  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    proration_behavior: "none",
    phases: [
      {
        items: [{ price: item.price.id, quantity: item.quantity ?? 1 }],
        start_date: current.start_date,
        end_date: periodEnd,
        proration_behavior: "none",
      },
      {
        items: [{ price: newPriceId, quantity: 1 }],
        // One period on the schedule, then it's released and simply renews at this price.
        duration: { interval: interval === "yearly" ? "year" : "month", interval_count: 1 },
        proration_behavior: "none",
        // From here the subscription speaks today's plan names (the webhook reads planVersion 2).
        metadata: stripePlanMetadata({ plexoUserId: user.id, plan, interval, region: group.id }),
      },
    ],
  });
  r.scheduled++;
  return { renewsAt, price, group, plan };
}
