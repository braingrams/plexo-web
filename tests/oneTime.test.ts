import { describe, expect, it } from "vitest";
import { hasRecurringPlan, isOneTimePlan, ONE_TIME_CHANNELS } from "@/lib/billing/oneTime";
import { planStatusLine } from "@/lib/dashboardV3/billingView";

const base = { subscriptionProvider: "PAYSTACK", subscriptionStatus: "ACTIVE" };

describe("paying once", () => {
  it("a plan paid once has no real subscription behind it and ends at the period's end", () => {
    expect(isOneTimePlan({ ...base, subscriptionId: "pending:plx_once_1", subscriptionCancelAtPeriodEnd: true })).toBe(true);
    expect(isOneTimePlan({ ...base, subscriptionId: "SUB_real", subscriptionCancelAtPeriodEnd: true })).toBe(false); // cancelled subscriber
    expect(isOneTimePlan({ ...base, subscriptionId: "pending:x", subscriptionCancelAtPeriodEnd: false })).toBe(false); // first payment waiting for its subscription
    expect(isOneTimePlan({ subscriptionProvider: "STRIPE", subscriptionId: "pending:x", subscriptionCancelAtPeriodEnd: true })).toBe(false);
  });
  it("paying once is not allowed on top of a plan that renews by itself (they'd be billed twice)", () => {
    expect(hasRecurringPlan({ ...base, subscriptionId: "SUB_real", subscriptionCancelAtPeriodEnd: false })).toBe(true);
    expect(hasRecurringPlan({ subscriptionProvider: "STRIPE", subscriptionStatus: "PAST_DUE", subscriptionId: "sub_1" })).toBe(true);
    expect(hasRecurringPlan({ ...base, subscriptionId: "SUB_real", subscriptionCancelAtPeriodEnd: true })).toBe(false); // already cancelled
    expect(hasRecurringPlan({ ...base, subscriptionId: "pending:plx_once_1", subscriptionCancelAtPeriodEnd: true })).toBe(false);
    expect(hasRecurringPlan({ subscriptionStatus: "CANCELED", subscriptionId: "SUB_old" })).toBe(false);
    expect(hasRecurringPlan({})).toBe(false);
  });
  it("offers transfer first", () => {
    expect(ONE_TIME_CHANNELS[0]).toBe("bank_transfer");
    expect([...ONE_TIME_CHANNELS]).toContain("card");
  });
  it("the plan page says it plainly", () => {
    const line = planStatusLine({ plan: "STARTER", paying: true, endsAt: "2026-12-05T00:00:00.000Z", oneTime: true });
    expect(line).toContain("You've paid for Starter until");
    expect(line).toContain("won't renew by itself");
    expect(planStatusLine({ plan: "STARTER", paying: true, endsAt: "2026-12-05T00:00:00.000Z" })).toContain("You've cancelled");
    expect(planStatusLine({ plan: "STARTER", paying: true, endsAt: "2027-11-05T00:00:00.000Z", oneTime: true, oneTimeInterval: "yearly" })).toContain("until 5 November 2027");
  });
});
