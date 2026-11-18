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

import { applyPaystackTransaction, handlePaystackBillingEvent, parsePaystackPlanName, addInterval, startPaystackPlanCheckout } from "@/lib/billing/paystackBilling";
import { initializePaystackTransaction } from "@/lib/paystack";
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
    db.users.set("u-pm", { id: "u-pm", email: "pm@x.com", subscriptionProvider: "PAYSTACK", subscriptionId: "SUB_1" });
    const reconcilePriceMove = vi.fn(async () => undefined);
    const handled = await handlePaystackBillingEvent({ event: "invoice.create", data: { customer: { email: "pm@x.com" }, subscription: { subscription_code: "SUB_1" } } }, { reconcilePriceMove });
    expect(handled).toBe(true);
    expect(reconcilePriceMove).toHaveBeenCalledWith("u-pm");
    const none = await handlePaystackBillingEvent({ event: "invoice.create", data: { customer: { email: "nobody@x.com" }, subscription: { subscription_code: "S" } } }, { reconcilePriceMove });
    expect(none).toBe(false);
    expect(reconcilePriceMove).toHaveBeenCalledTimes(1);
  });
});

describe("another Charisol product on the same Paystack account is never mistaken for Plexo", () => {
  const MAILDRIP = "Maildrip Pro monthly NGN 9000";
  beforeEach(() => {
    // The same person can be a customer of both products.
    db.users.set("u1", { id: "u1", email: "ada@example.com", subscriptionPlan: "STARTER", subscriptionProvider: "PAYSTACK", subscriptionId: "SUB_PLEXO", subscriptionStatus: "ACTIVE" });
  });
  it("ignores a charge, new subscription, cancellation and failed invoice on another product's plan", async () => {
    const deps = { syncPlanLifecycle: sync, reconcilePriceMove: vi.fn(async () => undefined), sendPaymentDeclinedEmail: vi.fn(async () => undefined) };
    const customer = { email: "ada@example.com", customer_code: "CUS_1" };
    const plan = { name: MAILDRIP, plan_code: "PLN_maildrip" };
    expect(await handlePaystackBillingEvent({ event: "charge.success", data: { status: "success", reference: "md1", amount: 900_000, currency: "NGN", customer, plan, metadata: {} } }, deps)).toBe(false);
    expect(await handlePaystackBillingEvent({ event: "subscription.create", data: { subscription_code: "SUB_MD", email_token: "t", plan, customer } }, deps)).toBe(false);
    expect(await handlePaystackBillingEvent({ event: "subscription.disable", data: { subscription_code: "SUB_MD", plan, customer } }, deps)).toBe(false);
    expect(await handlePaystackBillingEvent({ event: "invoice.create", data: { subscription: { subscription_code: "SUB_MD" }, customer } }, deps)).toBe(false);
    expect(await handlePaystackBillingEvent({ event: "invoice.payment_failed", data: { subscription: { subscription_code: "SUB_MD" }, customer, amount: 900_000, currency: "NGN" } }, deps)).toBe(true); // matches nothing, changes nothing
    expect(user()).toMatchObject({ subscriptionPlan: "STARTER", subscriptionId: "SUB_PLEXO", subscriptionStatus: "ACTIVE" });
    expect(deps.reconcilePriceMove).not.toHaveBeenCalled();
    expect(deps.sendPaymentDeclinedEmail).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
    expect(db.grants).toHaveLength(0);
  });
  it("still handles the person's own Plexo invoice", async () => {
    const reconcilePriceMove = vi.fn(async () => undefined);
    expect(await handlePaystackBillingEvent({ event: "invoice.create", data: { subscription: { subscription_code: "SUB_PLEXO" }, customer: { email: "ada@example.com" } } }, { reconcilePriceMove })).toBe(true);
    expect(reconcilePriceMove).toHaveBeenCalledWith("u1");
  });
});

describe("pay once (bank transfer, no automatic renewal)", () => {
  const once = (extra: Record<string, unknown> = {}) => firstPayment({ reference: "once1", metadata: { kind: "plexo_plan", plexoUserId: "u1", plan: "STARTER", interval: "monthly", region: "NG", oneTime: true }, ...extra });

  it("starts a payment with no Paystack plan attached (so transfer is offered), with transfer first, tagged as pay-once", async () => {
    vi.mocked(initializePaystackTransaction).mockResolvedValue({ authorizationUrl: "u", accessCode: "a", reference: "plx_once_x" } as never);
    const { DEFAULT_PRICE_BOOK, regionById } = await import("@/lib/billing/pricing");
    const region = regionById(DEFAULT_PRICE_BOOK, "NG");
    expect(region).toBeTruthy();
    await startPaystackPlanCheckout({ user: { id: "u1", email: "ada@example.com" }, region: region!, plan: "STARTER", interval: "monthly", callbackUrl: "https://x/cb", oneTime: true });
    const sent = vi.mocked(initializePaystackTransaction).mock.calls.at(-1)![0] as Record<string, any>;
    expect(sent.plan).toBeUndefined();
    expect(sent.channels[0]).toBe("bank_transfer");
    expect(sent.metadata).toMatchObject({ kind: "plexo_plan", oneTime: true, plan: "STARTER", interval: "monthly" });
    expect(String(sent.reference)).toMatch(/^plx_once/);
  });

  it("a payment puts the account on the plan for one period and marks it to end there (so reminders and the move to Free work)", async () => {
    await applyPaystackTransaction(once() as never, { syncPlanLifecycle: sync });
    expect(user()).toMatchObject({ subscriptionPlan: "STARTER", subscriptionStatus: "ACTIVE", subscriptionCancelAtPeriodEnd: true, subscriptionId: "pending:once1", subscriptionPeriodEnd: "2026-12-01T00:00:00.000Z" });
  });

  it("does not stop a subscription that already exists (that would have been blocked at checkout)", async () => {
    db.users.set("u1", { id: "u1", email: "ada@example.com", subscriptionPlan: "STARTER", subscriptionProvider: "PAYSTACK", subscriptionId: "SUB_real", paystackEmailToken: "tok", subscriptionStatus: "ACTIVE" });
    await applyPaystackTransaction(once() as never, { syncPlanLifecycle: sync });
    expect(disablePaystackSubscription).not.toHaveBeenCalled();
  });

  it("paying again while the plan is still running adds a period to its end instead of starting from today", async () => {
    db.users.set("u1", { id: "u1", email: "ada@example.com", subscriptionPlan: "STARTER", subscriptionProvider: "PAYSTACK", subscriptionId: "pending:once0", subscriptionStatus: "ACTIVE", subscriptionCancelAtPeriodEnd: true, subscriptionPeriodEnd: "2026-11-20T00:00:00.000Z", planVersion: 2 });
    await applyPaystackTransaction(once({ reference: "once2", paid_at: "2026-11-10T00:00:00.000Z" }) as never, { syncPlanLifecycle: sync });
    expect(user().subscriptionPeriodEnd).toBe("2026-12-20T00:00:00.000Z");
  });

  it("a yearly pay-once payment puts the end a year out", async () => {
    await applyPaystackTransaction(once({ reference: "once3", metadata: { kind: "plexo_plan", plexoUserId: "u1", plan: "STARTER", interval: "yearly", region: "NG", oneTime: true } }) as never, { syncPlanLifecycle: sync });
    expect(user()).toMatchObject({ subscriptionInterval: "yearly", subscriptionCancelAtPeriodEnd: true, subscriptionPeriodEnd: "2027-11-01T00:00:00.000Z" });
  });

  it("an ordinary subscription payment is not marked to end", async () => {
    await applyPaystackTransaction(firstPayment() as never, { syncPlanLifecycle: sync });
    expect(user().subscriptionCancelAtPeriodEnd).toBe(false);
  });
});
