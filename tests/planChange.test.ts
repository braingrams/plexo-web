import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import { PlanChangeError, changePlanInPlace, retireSupersededPlanSubscriptions } from "@/lib/billing/planChange";

beforeEach(() => {
  process.env.STRIPE_PRICE_PRO = "price_pro";
  process.env.STRIPE_PRICE_ULTRA = "price_ultra";
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
    expect(await changePlanInPlace(stripe, "cus_1", "ULTRA")).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("upgrades Pro to Ultra on the SAME subscription, billing only the prorated difference now", async () => {
    const { stripe, update } = fakeStripe([sub("s1", "PRO", 1)]);
    const res = await changePlanInPlace(stripe, "cus_1", "ULTRA");
    expect(res).toMatchObject({ changed: true, plan: "ULTRA", subscriptionId: "s1" });
    expect(update).toHaveBeenCalledWith("s1", expect.objectContaining({
      items: [{ id: "si_s1", price: "price_ultra" }],
      metadata: { plan: "ULTRA" },
      proration_behavior: "always_invoice",
      payment_behavior: "error_if_incomplete",
    }));
  });

  it("a downgrade credits unused time instead of charging", async () => {
    const { stripe, update } = fakeStripe([sub("s1", "ULTRA", 1)]);
    await changePlanInPlace(stripe, "cus_1", "PRO");
    expect(update).toHaveBeenCalledWith("s1", expect.objectContaining({ proration_behavior: "create_prorations" }));
  });

  it("refuses to 'change' to the plan they are already on", async () => {
    const { stripe, update } = fakeStripe([sub("s1", "ULTRA", 1)]);
    await expect(changePlanInPlace(stripe, "cus_1", "ULTRA")).rejects.toBeInstanceOf(PlanChangeError);
    expect(update).not.toHaveBeenCalled();
  });

  it("explains a declined card in plain words and changes nothing", async () => {
    const { stripe, update } = fakeStripe([sub("s1", "PRO", 1)]);
    update.mockRejectedValueOnce({ type: "StripeCardError", message: "Your card has insufficient funds." });
    await expect(changePlanInPlace(stripe, "cus_1", "ULTRA")).rejects.toMatchObject({ status: 402, message: expect.stringContaining("plan wasn't changed") });
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
