/**
 * "Pay once" plan payments (Paystack regions): someone pays for one month or one year, by bank transfer, card or USSD, with no automatic
 * renewal. Bank transfer can't be charged again by itself, so Paystack only offers it on a payment that is NOT a subscription.
 *
 * It is stored as an ordinary paid plan that already "ends at the period's end": a Paystack subscriber who cancelled looks the same
 * (cancel-at-period-end), so the plan, the week/day/today reminders and the move to Free at the end all work as they do today. What tells it
 * apart from a cancelled subscription is that no real Paystack subscription sits behind it (its id is "pending:<payment reference>").
 */
export type OneTimeUser = {
  subscriptionProvider?: string | null;
  subscriptionId?: string | null;
  subscriptionStatus?: string | null;
  subscriptionCancelAtPeriodEnd?: boolean | null;
};

/** A plan that was paid for once and will simply end. */
export function isOneTimePlan(user: OneTimeUser): boolean {
  return user.subscriptionProvider === "PAYSTACK" && !!user.subscriptionId?.startsWith("pending:") && user.subscriptionCancelAtPeriodEnd === true;
}

/** A plan that charges again by itself (a real subscription that has not been cancelled). Paying once on top of it would bill them twice. */
export function hasRecurringPlan(user: OneTimeUser): boolean {
  const live = user.subscriptionStatus === "ACTIVE" || user.subscriptionStatus === "TRIALING" || user.subscriptionStatus === "PAST_DUE";
  return live && !!user.subscriptionId && !user.subscriptionId.startsWith("pending:") && user.subscriptionCancelAtPeriodEnd !== true;
}

/** Methods offered for a pay-once payment: transfer first. (Paystack only shows the ones switched on for the account.) */
export const ONE_TIME_CHANNELS = ["bank_transfer", "card", "ussd", "bank"] as const;
