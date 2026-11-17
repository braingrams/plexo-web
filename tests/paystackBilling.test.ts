import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  users: new Map<string, Record<string, unknown>>(),
  payments: new Set<string>(),
  grants: [] as unknown[][],
  topups: [] as unknown[][],
}));

vi.mock("@/lib/db/coreEntities", () => {
  const User = {
    get: ({ id }: { id: string }) => ({ go: async () => ({ data: db.users.get(id) ?? null }) }),
    query: { byEmail: ({ email }: { email: string }) => ({ go: async () => ({ data: [...db.users.values()].filter((u) => u.email === email) }) }) },
    patch: ({ id }: { id: string }) => {
      let sets: Record<string, unknown> = {};
      let removes: string[] = [];
      const b = {
        set: (v: Record<string, unknown>) => ((sets = { ...sets, ...v }), b),
        remove: (n: string[]) => ((removes = n), b),
        go: async () => {
          const row = { ...db.users.get(id), ...sets };
          for (const r of removes) delete row[r];
          db.users.set(id, row);
        },
      };
      return b;
    },
  };
  return { User, Member: { query: { byUser: () => ({ go: async () => ({ data: [] }) }) } } };
});
vi.mock("@/lib/db/ledgerEntities", () => ({ Payment: { get: ({ id }: { id: string }) => ({ go: async () => ({ data: db.payments.has(id) ? { id } : null }) }) } }));
vi.mock("@/lib/db/ledgerOperations", () => ({
  grantPlanChangeAllowance: vi.fn(async (...a: unknown[]) => void db.grants.push(a)),
  grantTopup: vi.fn(async (...a: unknown[]) => void db.topups.push(a)),
}));
vi.mock("@/lib/lms/funnelSlots", () => ({ reconcileFunnelSlotsForOrg: vi.fn() }));
vi.mock("@/lib/billing/payments", () => ({
  recordPaystackPayment: vi.fn(async (i: { reference: string }) => {
    db.payments.add(`paystack_${i.reference}`);
    return { becamePaid: true, payment: { id: i.reference } };
  }),
  sendReceiptEmail: vi.fn(async () => ({ sent: true, to: "x" })),
}));
vi.mock("@/lib/paystack", () => ({
  createPaystackPlan: vi.fn(),
  disablePaystackSubscription: vi.fn(async () => {}),
  fetchPaystackSubscription: vi.fn(),
  initializePaystackTransaction: vi.fn(),
  listPaystackPlans: vi.fn(),
  verifyPaystackTransaction: vi.fn(),
}));
vi.mock("@/lib/billing/priceBook", async () => {
  const { DEFAULT_PRICE_BOOK } = await import("@/lib/billing/pricing");
  return { loadPriceBook: async () => DEFAULT_PRICE_BOOK };
});

import { applyPaystackTransaction, handlePaystackBillingEvent, parsePaystackPlanName, addInterval } from "@/lib/billing/paystackBilling";
import { disablePaystackSubscription } from "@/lib/paystack";
import { effectivePlan } from "@/lib/plan/entitlement";

const sync = vi.fn(async () => {});
const user = () => db.users.get("u1") as Record<string, unknown>;
const PLAN_NAME = "Plexo Starter monthly NGN 3000 (abc)";
const firstPayment = (extra: Record<string, unknown> = {}) => ({
  status: "success", reference: "ref1", amount: 300_000, currency: "NGN", paid_at: "2026-11-01T00:00:00.000Z",
  customer: { email: "ada@example.com", customer_code: "CUS_1" },
  metadata: { kind: "plexo_plan", plexoUserId: "u1", plan: "STARTER", interval: "monthly", region: "NG" },
  ...extra,
});

beforeEach(() => {
  db.users.clear(); db.payments.clear(); db.grants.length = 0; db.topups.length = 0;
  sync.mockClear();
  vi.mocked(disablePaystackSubscription).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.PLATFORM_PAYSTACK_SECRET_KEY = "sk_test_x";
  db.users.set("u1", { id: "u1", email: "ada@example.com", subscriptionPlan: "FREE" });
});

describe("Paystack plan billing (mocked Paystack)", () => {
  it("reads our plan names back", () => {
    expect(parsePaystackPlanName(PLAN_NAME)).toEqual({ plan: "STARTER", interval: "monthly", currency: "NGN" });
    expect(parsePaystackPlanName("Some other plan")).toBeNull();
    expect(addInterval("2026-01-31T00:00:00.000Z", "yearly")).toBe("2027-01-31T00:00:00.000Z");
  });

  it("a first payment puts the account on the plan, records it provider-agnostically, and is idempotent", async () => {
    const res = await applyPaystackTransaction(firstPayment() as never, { syncPlanLifecycle: sync });
    expect(res).toEqual({ applied: "plan", userId: "u1", plan: "STARTER" });
    expect(user()).toMatchObject({ subscriptionPlan: "STARTER", planVersion: 2, subscriptionProvider: "PAYSTACK", subscriptionStatus: "ACTIVE", subscriptionInterval: "monthly", subscriptionPeriodEnd: "2026-12-01T00:00:00.000Z", billingCurrency: "NGN", billingRegion: "NG" });
    expect(effectivePlan(user() as never, new Date("2026-11-15"))).toBe("STARTER");
    expect(db.grants).toHaveLength(1);
    expect(sync).toHaveBeenCalledTimes(1);
    await applyPaystackTransaction(firstPayment() as never, { syncPlanLifecycle: sync }); // the webhook arriving after verify
    expect(db.grants).toHaveLength(1);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("charge.success webhook applies a first payment; failed charges and other people's charges are ignored", async () => {
    expect(await handlePaystackBillingEvent({ event: "charge.success", data: firstPayment() }, { syncPlanLifecycle: sync })).toBe(true);
    expect(user().subscriptionPlan).toBe("STARTER");
    expect(await handlePaystackBillingEvent({ event: "charge.success", data: { status: "success", reference: "order1", metadata: { orderId: "o" } } })).toBe(false);
  });

  it("subscription.create saves the subscription code and email token (needed to cancel)", async () => {
    await handlePaystackBillingEvent({ event: "charge.success", data: firstPayment() }, { syncPlanLifecycle: sync });
    await handlePaystackBillingEvent({ event: "subscription.create", data: { subscription_code: "SUB_1", email_token: "tok", plan: { name: PLAN_NAME }, customer: { email: "ada@example.com" }, next_payment_date: "2026-12-01T00:00:00.000Z" } }, { syncPlanLifecycle: sync });
    expect(user()).toMatchObject({ subscriptionId: "SUB_1", paystackEmailToken: "tok", subscriptionPlan: "STARTER" });
  });

  it("a renewal (charge on our plan) moves the period on without changing the plan", async () => {
    db.users.set("u1", { ...user(), subscriptionPlan: "STARTER", planVersion: 2, subscriptionProvider: "PAYSTACK", subscriptionId: "SUB_1", subscriptionStatus: "PAST_DUE", subscriptionPeriodEnd: "2026-12-01T00:00:00.000Z" });
    const res = await applyPaystackTransaction({ ...firstPayment({ reference: "ref2", paid_at: "2026-12-01T00:00:00.000Z", metadata: {}, plan: { name: PLAN_NAME } }) } as never, { syncPlanLifecycle: sync });
    expect(res.applied).toBe("renewal");
    expect(user()).toMatchObject({ subscriptionId: "SUB_1", subscriptionStatus: "ACTIVE", subscriptionPeriodEnd: "2027-01-01T00:00:00.000Z" });
    expect(db.grants).toHaveLength(0);
  });

  it("switching plan stops the previous Paystack subscription so nobody is billed twice", async () => {
    db.users.set("u1", { ...user(), subscriptionPlan: "STARTER", planVersion: 2, subscriptionProvider: "PAYSTACK", subscriptionId: "SUB_OLD", paystackEmailToken: "tok" });
    await applyPaystackTransaction(firstPayment({ reference: "ref3", metadata: { kind: "plexo_plan", plexoUserId: "u1", plan: "PRO", interval: "monthly", region: "NG" } }) as never, { syncPlanLifecycle: sync });
    expect(disablePaystackSubscription).toHaveBeenCalledWith(expect.objectContaining({ code: "SUB_OLD" }));
    expect(user().subscriptionPlan).toBe("PRO");
  });

  it("cancelling runs to the end of the paid period; a failed renewal marks it past due and emails", async () => {
    db.users.set("u1", { ...user(), subscriptionPlan: "PRO", planVersion: 2, subscriptionProvider: "PAYSTACK", subscriptionId: "SUB_1", subscriptionStatus: "ACTIVE", subscriptionPeriodEnd: new Date(Date.now() + 10 * 864e5).toISOString() });
    await handlePaystackBillingEvent({ event: "subscription.not_renew", data: { subscription_code: "SUB_1", customer: { email: "ada@example.com" }, plan: { name: "Plexo Pro monthly NGN 7500" } } }, { syncPlanLifecycle: sync });
    expect(user()).toMatchObject({ subscriptionCancelAtPeriodEnd: true, subscriptionStatus: "ACTIVE" });
    const declined = vi.fn(async () => {});
    await handlePaystackBillingEvent({ event: "invoice.payment_failed", data: { amount: 750_000, currency: "NGN", subscription: { subscription_code: "SUB_1" }, customer: { email: "ada@example.com" } } }, { syncPlanLifecycle: sync, sendPaymentDeclinedEmail: declined });
    expect(user().subscriptionStatus).toBe("PAST_DUE");
    expect(declined).toHaveBeenCalledTimes(1);
  });

  it("a top-up grants credits at the rate it was sold at ($1 = 1,000 credits; NGN 1,500)", async () => {
    await handlePaystackBillingEvent({ event: "charge.success", data: { status: "success", reference: "top1", amount: 3_000_000, currency: "NGN", customer: { email: "ada@example.com" }, metadata: { kind: "plexo_topup", plexoUserId: "u1", pack: "SMALL", region: "NG" } } });
    expect(db.topups[0][1]).toBe(20_000); // NGN 30,000 at 1,500 per 1,000
  });
});

describe("pre-renewal webhook: invoice.create moves the subscriber to a changed price", () => {
  it("asks the price-move job to reconcile just that person, and handles nobody else's event", async () => {
    const { handlePaystackBillingEvent } = await import("@/lib/billing/paystackBilling");
    db.users.set("u-pm", { id: "u-pm", email: "pm@x.com", subscriptionProvider: "PAYSTACK" });
    const reconcilePriceMove = vi.fn(async () => undefined);
    const handled = await handlePaystackBillingEvent({ event: "invoice.create", data: { customer: { email: "pm@x.com" }, subscription: { subscription_code: "SUB_1" } } }, { reconcilePriceMove });
    expect(handled).toBe(true);
    expect(reconcilePriceMove).toHaveBeenCalledWith("u-pm");
    const none = await handlePaystackBillingEvent({ event: "invoice.create", data: { customer: { email: "nobody@x.com" }, subscription: { subscription_code: "S" } } }, { reconcilePriceMove });
    expect(none).toBe(false);
    expect(reconcilePriceMove).toHaveBeenCalledTimes(1);
  });
});
