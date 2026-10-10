// Whether an account is still entitled to the paid plan stored on it, and what the plan
// lifecycle (lib/plan/lifecycle.ts) has to do about it. Pure: every caller passes the
// User row it already loaded, so this costs nothing on the hot paths that use it
// (resolveSite on every public request, resolveUser on every API call).

import { MARKETPLACE_OWNER_EMAIL } from "@/lib/marketplaceOwnerEmail";

export const TRIAL_DAYS = 14;
export const TRIAL_PLANS = ["PRO", "ULTRA"] as const;
export type TrialPlan = (typeof TRIAL_PLANS)[number];

export type DowngradeReason = "PAYMENT_ENDED" | "TRIAL_ENDED" | "GRANT_ENDED" | "NO_PAYMENT" | "ADMIN";

/** The User fields the lifecycle reads — a structural subset, so tests and both repos can pass plain objects. */
export type PlanUser = {
  email?: string | null;
  subscriptionPlan?: string | null;
  subscriptionStatus?: string | null;
  stripeSubscriptionId?: string | null;
  planAccessUntil?: string | null;
  planAccessSource?: string | null;
  planKeptByAdmin?: boolean | null;
  adminRole?: string | null;
  planDowngradedAt?: string | null;
  freeLimitsAppliedAt?: string | null;
};

export type PaidAccess =
  | { entitled: true; basis: "ADMIN_KEPT" | "STAFF" | "SUBSCRIPTION" | "SUBSCRIPTION_UNVERIFIED" | "TRIAL" | "GRANT" }
  | { entitled: false; reason: DowngradeReason };

const LIVE_SUBSCRIPTION = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);

export function isPaidPlan(plan: string | null | undefined): boolean {
  return plan === "PRO" || plan === "ULTRA";
}

/**
 * Why (or whether) a paid plan is still owed. Only meaningful for a PRO/ULTRA account —
 * Free has nothing to expire.
 */
export function paidAccess(user: PlanUser, now: Date = new Date()): PaidAccess {
  if (user.planKeptByAdmin) return { entitled: true, basis: "ADMIN_KEPT" };
  // Charisol staff and Plexo's own system account (it owns the official marketplace
  // templates) are never billed.
  if (user.adminRole || (user.email && user.email.toLowerCase() === MARKETPLACE_OWNER_EMAIL)) {
    return { entitled: true, basis: "STAFF" };
  }
  if (user.stripeSubscriptionId) {
    if (user.subscriptionStatus && LIVE_SUBSCRIPTION.has(user.subscriptionStatus)) return { entitled: true, basis: "SUBSCRIPTION" };
    // A subscription recorded before statuses were tracked: trusted until the hourly
    // sweep confirms it with Stripe (lib/plan/lifecycle.ts verifyStripeSubscription).
    if (!user.subscriptionStatus) return { entitled: true, basis: "SUBSCRIPTION_UNVERIFIED" };
  }
  if (user.planAccessUntil) {
    const until = Date.parse(user.planAccessUntil);
    if (Number.isFinite(until) && until > now.getTime()) {
      return { entitled: true, basis: user.planAccessSource === "TRIAL" ? "TRIAL" : "GRANT" };
    }
    return { entitled: false, reason: user.planAccessSource === "TRIAL" ? "TRIAL_ENDED" : "GRANT_ENDED" };
  }
  if (user.stripeSubscriptionId || user.subscriptionStatus) return { entitled: false, reason: "PAYMENT_ENDED" };
  return { entitled: false, reason: "NO_PAYMENT" };
}

/** The plan every limit should be checked against right now — Free the moment paid access lapses, even before the downgrade has been written. */
export function effectivePlan(user: PlanUser | null | undefined, now: Date = new Date()): "FREE" | "PRO" | "ULTRA" {
  const plan = user?.subscriptionPlan;
  if (!user || !isPaidPlan(plan)) return "FREE";
  return paidAccess(user, now).entitled ? (plan as "PRO" | "ULTRA") : "FREE";
}

export type PlanSyncAction = "downgrade" | "restore" | "enforce_free";

/**
 * What the stored state still owes the plan, if anything:
 *  - downgrade: a paid plan whose payment/trial/grant has ended;
 *  - restore: a paid plan (paid again, or switched on by an admin) with a Free-era archive
 *    still in place — bring every page, site and domain back;
 *  - enforce_free: a Free account whose sites haven't had Free's limits applied yet
 *    (an admin moved it to Free, or it predates enforcement).
 */
export function planSyncAction(user: PlanUser, now: Date = new Date()): PlanSyncAction | null {
  if (isPaidPlan(user.subscriptionPlan)) {
    if (!paidAccess(user, now).entitled) return "downgrade";
    if (user.planDowngradedAt || user.freeLimitsAppliedAt) return "restore";
    return null;
  }
  return user.freeLimitsAppliedAt ? null : "enforce_free";
}

/** Whole days of paid access left (rounded up), or null when it isn't time-limited. */
export function accessDaysLeft(user: PlanUser, now: Date = new Date()): number | null {
  if (!user.planAccessUntil || user.planKeptByAdmin) return null;
  const ms = Date.parse(user.planAccessUntil) - now.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

const TRIAL_OFFER_WINDOW_MS = 7 * 86_400_000;

/** Show the post-signup "try Pro or Ultra free" screen: a new account that's never trialled, paid or been shown it. */
export function shouldOfferTrial(
  user: PlanUser & { trialStartedAt?: string | null; trialOfferSeenAt?: string | null; createdAt?: string | null },
  now: Date = new Date(),
): boolean {
  if (user.trialStartedAt || user.trialOfferSeenAt || user.stripeSubscriptionId || user.planDowngradedAt) return false;
  if ((user.subscriptionPlan ?? "FREE") !== "FREE") return false;
  const created = Date.parse(user.createdAt ?? "");
  return Number.isFinite(created) && now.getTime() - created < TRIAL_OFFER_WINDOW_MS;
}

/**
 * May start the one free trial now — any account that's never had one and isn't paying,
 * whenever it likes (not just right after signup: shouldOfferTrial only decides when the
 * offer screen pops up by itself).
 */
export function canStartTrial(user: PlanUser & { trialStartedAt?: string | null }, now: Date = new Date()): boolean {
  if (user.trialStartedAt) return false;
  return effectivePlan(user, now) === "FREE";
}
