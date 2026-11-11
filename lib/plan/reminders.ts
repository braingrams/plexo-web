// "Your plan ends soon" reminders: a week before, a day before, and on the day itself — for
// everyone whose paid access has an end date. Pure rules only (no database, no email), so the
// timing is easy to test; lifecycle.ts's sendAccessEndingReminder sends them.
//
// Who has an end date:
//  • a free trial (planAccessUntil, source TRIAL) and an admin grant with an end date (ADMIN);
//  • a paying subscriber who has cancelled and so ends at the period's end;
//  • a paying subscriber who is renewing (kind RENEWING — the date is the next charge).
// A subscriber who is simply renewing gets one different, calmer email a week before the charge
// ("your plan renews on …, make sure your card can cover it") — never an "ends" warning.

import { paidAccess, isPaidPlan, type PlanUser } from "./entitlement";

export type ReminderStage = "WEEK" | "DAY" | "TODAY";
export type ReminderKind = "TRIAL" | "GRANT" | "CANCELLING" | "RENEWING";

export const STAGE_ORDER: Record<ReminderStage, number> = { WEEK: 1, DAY: 2, TODAY: 3 };

const HOUR = 3_600_000;

export type ReminderUser = PlanUser & {
  planAccessUntil?: string | null;
  planAccessSource?: string | null;
  planAccessReminderSentAt?: string | null;
  planExpiryReminderKey?: string | null;
  subscriptionStatus?: string | null;
  subscriptionPeriodEnd?: string | null;
  subscriptionCancelAtPeriodEnd?: boolean | null;
};

export type DueReminder = { stage: ReminderStage; kind: ReminderKind; endsAt: string; key: string };

/** When this account's paid access will end, if it will — and why. */
export function accessEnd(user: ReminderUser, now: Date): { endsAt: string; kind: ReminderKind } | null {
  if (!isPaidPlan(user.subscriptionPlan)) return null;
  const access = paidAccess(user, now);
  if (!access.entitled) return null;
  if ((access.basis === "TRIAL" || access.basis === "GRANT") && user.planAccessUntil) {
    return { endsAt: user.planAccessUntil, kind: access.basis };
  }
  if (
    access.basis === "SUBSCRIPTION" &&
    user.subscriptionPeriodEnd &&
    (user.subscriptionStatus === "ACTIVE" || user.subscriptionStatus === "TRIALING")
  ) {
    return { endsAt: user.subscriptionPeriodEnd, kind: user.subscriptionCancelAtPeriodEnd ? "CANCELLING" : "RENEWING" };
  }
  return null;
}

/** Which stage the end date is in right now: today (the last 12 hours, on the end's own day), a day out, a week out, or none. */
export function currentStage(endsAt: string, now: Date): ReminderStage | null {
  const end = Date.parse(endsAt);
  const msLeft = end - now.getTime();
  if (!Number.isFinite(end) || msLeft <= 0) return null;
  const sameUtcDay = new Date(end).toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
  if (sameUtcDay && msLeft <= 12 * HOUR) return "TODAY";
  if (msLeft <= 24 * HOUR) return "DAY";
  if (msLeft <= 7 * 24 * HOUR) return "WEEK";
  return null;
}

/** What was already sent for this end date, as a stage — including the old single "3 days" reminder, counted as the week one. */
function sentStage(user: ReminderUser, endsAt: string): ReminderStage | null {
  const key = user.planExpiryReminderKey;
  if (key) {
    const [end, stage] = key.split("#");
    if (end === endsAt && stage in STAGE_ORDER) return stage as ReminderStage;
  }
  return user.planAccessReminderSentAt === endsAt ? "WEEK" : null;
}

/**
 * The reminder to send this account now, or null. Only the most urgent stage reached is ever
 * returned, and never one at or below a stage already sent — an account seen for the first time
 * two days out gets one email, not two.
 */
export function dueReminder(user: ReminderUser, now: Date = new Date()): DueReminder | null {
  const end = accessEnd(user, now);
  if (!end) return null;
  // A renewal gets just the one heads-up, a week ahead; the countdown stages are for plans that end.
  const left = Date.parse(end.endsAt) - now.getTime();
  const stage: ReminderStage | null = end.kind === "RENEWING" ? (left > 0 && left <= 7 * 24 * HOUR ? "WEEK" : null) : currentStage(end.endsAt, now);
  if (!stage) return null;
  const sent = sentStage(user, end.endsAt);
  if (sent && STAGE_ORDER[sent] >= STAGE_ORDER[stage]) return null;
  return { stage, kind: end.kind, endsAt: end.endsAt, key: `${end.endsAt}#${stage}` };
}
