import type { EntityItem } from "electrodb";

import { User } from "@/lib/db/coreEntities";
import { isPaidPlan, planSyncAction } from "./entitlement";
import { sendAccessEndingReminder, syncPlanLifecycle, verifyStripeSubscription } from "./lifecycle";

type UserItem = EntityItem<typeof User>;

export type SweepReport = {
  scanned: number;
  verified: number;
  reminded: number;
  synced: number;
  failed: number;
  complete: boolean;
};

/**
 * The backstop for everything the instant paths (Stripe webhooks, dashboard loads, site
 * visits) don't reach on their own: a trial or admin grant that ran out for someone who
 * hasn't been back, a subscription from before statuses were tracked (checked with Stripe),
 * "ends in 3 days" reminders, and an account an admin changed directly.
 *
 * Idempotent, so a run cut short by the time budget is simply finished by the next one.
 * Reads the whole core table once per run (DynamoDB on-demand: a scan costs about $0.25
 * per million 4 KB reads — at Plexo's current size, cents per month even hourly). Past
 * ~100k accounts this should move to a sparse "has time-limited access" index.
 */
export async function runPlanSweep(opts: { now?: Date; budgetMs?: number } = {}): Promise<SweepReport> {
  const now = opts.now ?? new Date();
  const deadline = Date.now() + (opts.budgetMs ?? 50_000);
  const report: SweepReport = { scanned: 0, verified: 0, reminded: 0, synced: 0, failed: 0, complete: false };

  let cursor: string | null = null;
  do {
    if (Date.now() > deadline) return report;
    const page: { data: UserItem[]; cursor: string | null } = await User.scan.go({ cursor });
    cursor = page.cursor;
    report.scanned += page.data.length;
    for (let i = 0; i < page.data.length; i += 5) {
      if (Date.now() > deadline) return report;
      await Promise.all(page.data.slice(i, i + 5).map((user) => sweepUser(user, now, report)));
    }
  } while (cursor);
  report.complete = true;
  return report;
}

async function sweepUser(user: UserItem, now: Date, report: SweepReport): Promise<void> {
  try {
    if (isPaidPlan(user.subscriptionPlan) && user.stripeSubscriptionId && !user.subscriptionStatus) {
      await verifyStripeSubscription(user, now);
      report.verified++;
      user = (await User.get({ id: user.id }).go()).data ?? user;
    }
    if (await sendAccessEndingReminder(user, now)) report.reminded++;
    if (planSyncAction(user, now)) {
      const steps = await syncPlanLifecycle(user.id, now);
      if (steps.length) report.synced++;
    }
  } catch (err) {
    report.failed++;
    console.error(`plan sweep: account ${user.id} failed`, err);
  }
}
