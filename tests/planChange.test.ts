import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import { PlanChangeError, changePlanInPlace, retireSupersededPlanSubscriptions } from "@/lib/billing/planChange";

beforeEach(() => {
});

function sub(id: string, plan: string | null, created: number, status = "active", extra: Record<string, string> = {}) {
  return { id, status, created, metadata: { ...(plan ? { plan } : {}), ...extra }, items: { data: [{ id: `si_${id}` }] } };
}

function fakeStripe(subs: ReturnType<typeof sub>[]) {
  const update = vi.fn(async (id: string) => ({ id }));
  const cancel = vi.fn(async (id: string) => ({ id }));
  const list = vi.fn(() => (async function* () { for (const s of subs) yield s; })());
  return { stripe: { subscriptions: { list, update, cancel } } as unknown as Stripe, update, cancel };
}

describe("changePlanInPlace", () => {
  it("returns null when there is no live plan subscription, so a normal Checkout starts", async () => {
    const { stripe, update } = fakeStripe([sub("s1", "PRO", 1, "canceled"), sub("slot", null, 2, "active", { kind: "lms_addon_slot" })]);
    expect(await changePlanInPlace(stripe, "cus_1", "PRO", "price_pro", {})).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("upgrades a legacy Pro (= Starter) to Pro on the SAME subscription, billing only the difference now", async () => {
    const { stripe, update } = fakeStripe([sub("s1", "PRO", 1)]); // no planVersion: legacy PRO = STARTER
    const res = await changePlanInPlace(stripe, "cus_1", "PRO", "price_new", { plan: "PRO", planVersion: "2" });
    expect(res).toMatchObject({ changed: true, plan: "PRO", subscriptionId: "s1" });
    expect(update).toHaveBeenCalledWith("s1", expect.objectContaining({
      items: [{ id: "si_s1", price: "price_new" }],
      metadata: expect.objectContaining({ plan: "PRO", planVersion: "2" }),
      proration_behavior: "always_invoice",
      payment_behavior: "error_if_incomplete",
    }));
  });

  it("a downgrade credits unused time instead of charging", async () => {
    const { stripe, update } = fakeStripe([sub("s1", "PRO", 1, "active", { planVersion: "2" })]);
    await changePlanInPlace(stripe, "cus_1", "STARTER", "price_s", { plan: "STARTER", planVersion: "2" });
    expect(update).toHaveBeenCalledWith("s1", expect.objectContaining({ proration_behavior: "create_prorations" }));
  });

  it("refuses to 'change' to the price they are already on", async () => {
    const s = { ...sub("s1", "PRO", 1, "active", { planVersion: "2" }), items: { data: [{ id: "si_s1", price: { id: "price_pro" } }] } };
    const { stripe, update } = fakeStripe([s as never]);
    await expect(changePlanInPlace(stripe, "cus_1", "PRO", "price_pro", {})).rejects.toBeInstanceOf(PlanChangeError);
    expect(update).not.toHaveBeenCalled();
  });

  it("explains a declined card in plain words and changes nothing", async () => {
    const { stripe, update } = fakeStripe([sub("s1", "PRO", 1)]);
    update.mockRejectedValueOnce({ type: "StripeCardError", message: "Your card has insufficient funds." });
    await expect(changePlanInPlace(stripe, "cus_1", "PRO", "price_x", {})).rejects.toMatchObject({ status: 402, message: expect.stringContaining("plan wasn't changed") });
  });
});

describe("retireSupersededPlanSubscriptions", () => {
  it("keeps the newest plan subscription and cancels the older duplicate (the Rukky case)", async () => {
    const { stripe, cancel } = fakeStripe([sub("pro_old", "PRO", 1), sub("ultra_new", "ULTRA", 5), sub("slot", null, 9, "active", { kind: "lms_addon_slot" })]);
    expect(await retireSupersededPlanSubscriptions(stripe, "cus_1")).toEqual(["pro_old"]);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("pro_old", { prorate: true, invoice_now: true });
  });

  it("does nothing when there is only one", async () => {
    const { stripe, cancel } = fakeStripe([sub("s1", "PRO", 1)]);
    expect(await retireSupersededPlanSubscriptions(stripe, "cus_1")).toEqual([]);
    expect(cancel).not.toHaveBeenCalled();
  });
});
