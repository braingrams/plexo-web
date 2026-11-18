import { describe, expect, it, vi } from "vitest";

import { runPlanMigration, userRewrite, type LegacyUser } from "@/lib/billing/planMigration";
import { DEFAULT_PRICE_BOOK } from "@/lib/billing/pricing";

const u = (id: string, extra: Partial<LegacyUser> = {}): LegacyUser => ({ id, email: `${id}@x.com`, ...extra }) as LegacyUser;
const users: LegacyUser[] = [
  u("pro", { subscriptionPlan: "PRO", stripeSubscriptionId: "sub_pro", subscriptionStatus: "ACTIVE" }),
  u("ultra", { subscriptionPlan: "ULTRA", stripeSubscriptionId: "sub_ultra", subscriptionStatus: "ACTIVE", planBeforeDowngrade: "ULTRA" }),
  u("free", { subscriptionPlan: "FREE" }),
  u("done", { subscriptionPlan: "PRO", planVersion: 2 }),
];

function deps(apply: boolean, notify = false) {
  const subs: Record<string, unknown> = {
    sub_pro: { id: "sub_pro", status: "active", customer: "cus_1", cancel_at_period_end: false, schedule: null, items: { data: [{ price: { id: "price_old", recurring: { interval: "month" } }, current_period_end: 1_800_000_000, quantity: 1 }] } },
    sub_ultra: { id: "sub_ultra", status: "active", customer: "cus_2", cancel_at_period_end: false, schedule: null, items: { data: [{ price: { id: "price_old2", recurring: { interval: "month" } }, current_period_end: 1_800_000_000 }] } },
  };
  const stripe = {
    subscriptions: { retrieve: vi.fn(async (id: string) => subs[id]) },
    subscriptionSchedules: { create: vi.fn(async () => ({ id: "sch_1", phases: [{ start_date: 1 }] })), update: vi.fn(async () => ({})), retrieve: vi.fn() },
    customers: { retrieve: vi.fn(async () => ({ deleted: false, address: { country: "US" } })) },
  };
  const patchUser = vi.fn(async () => true);
  const ensurePrice = vi.fn(async () => "price_new");
  const sendEmail = vi.fn(async () => {});
  const logs: string[] = [];
  return { stripe, patchUser, ensurePrice, sendEmail, logs, d: { apply, notify, book: DEFAULT_PRICE_BOOK, listUsers: async function* () { yield* users; }, patchUser, stripe: stripe as never, ensurePrice, sendEmail, log: (l: string) => void logs.push(l) } };
}

describe("legacy plan migration", () => {
  it("rewrites old PRO to STARTER and ULTRA to PRO, stamps planVersion 2, skips finished rows", () => {
    expect(userRewrite(users[0])).toMatchObject({ subscriptionPlan: "STARTER", planVersion: 2 });
    expect(userRewrite(users[1])).toMatchObject({ subscriptionPlan: "PRO", planBeforeDowngrade: "PRO" });
    expect(userRewrite(users[2])).toMatchObject({ subscriptionPlan: "FREE" });
    expect(userRewrite(users[3])).toBeNull();
  });

  it("dry run reports what it would do and changes nothing (no writes, no Stripe changes, no emails)", async () => {
    const { d, patchUser, stripe, ensurePrice, sendEmail, logs } = deps(false, true);
    const report = await runPlanMigration(d);
    expect(report).toMatchObject({ scanned: 4, rewritten: 3, alreadyDone: 1, scheduled: 2, failed: 0, emailed: 0 });
    expect(patchUser).not.toHaveBeenCalled();
    expect(ensurePrice).not.toHaveBeenCalled();
    expect(stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(logs.join("\n")).toMatch(/would rewrite pro@x.com: PRO → STARTER/);
  });

  it("apply writes rows and books the new price from the next renewal, with no proration", async () => {
    const { d, patchUser, stripe, sendEmail } = deps(true, true);
    const report = await runPlanMigration(d);
    expect(report).toMatchObject({ rewritten: 3, scheduled: 2, emailed: 2 });
    expect(patchUser).toHaveBeenCalledTimes(3);
    expect(stripe.subscriptionSchedules.update).toHaveBeenCalledWith("sch_1", expect.objectContaining({ proration_behavior: "none" }));
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("is idempotent: a row another run already migrated is counted, not rewritten twice", async () => {
    const { d } = deps(true);
    d.patchUser = vi.fn(async () => false);
    const report = await runPlanMigration(d);
    expect(report.rewritten).toBe(0);
    expect(report.alreadyDone).toBe(4);
  });
});
