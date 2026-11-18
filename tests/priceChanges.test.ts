import { describe, expect, it } from "vitest";

import { DEFAULT_PRICE_BOOK, type PriceBook, type PriceGroup } from "@/lib/billing/pricing";
import { buildChangeEntries, nextPriceNotice, previewChange, priceAtNextRenewal, resolveEffectiveFrom, summarizeImpact, type PriceChangeRow, type SubscriberPriceInput } from "@/lib/billing/priceChanges";

const NOW = new Date("2026-11-17T10:00:00Z");
const ng = (book: PriceBook) => book.groups.find((g) => g.id === "NG")!;
const withNg = (patch: Partial<PriceGroup>): PriceBook => ({ ...DEFAULT_PRICE_BOOK, version: 2, groups: DEFAULT_PRICE_BOOK.groups.map((g) => (g.id === "NG" ? { ...g, ...patch } : g)) });

function change(over: Partial<PriceChangeRow> & { newAmount?: number | null; interval?: "monthly" | "yearly"; oldAmount?: number }): PriceChangeRow {
  const { newAmount = 3500, interval = "monthly", oldAmount = 3000, ...rest } = over;
  return {
    id: "c1", version: 1, createdAt: "2026-11-01T00:00:00Z", existingSubscribers: { when: "next_renewal" }, effectiveFrom: "2026-11-01T00:00:00Z", status: "scheduled",
    entries: [{ groupId: "NG", plan: "STARTER", interval, currency: "NGN", provider: "PAYSTACK", oldAmount, newAmount }], ...rest,
  };
}
const sub = (over: Partial<SubscriberPriceInput> = {}): SubscriberPriceInput => ({
  plan: "STARTER", interval: "monthly", groupId: "NG", currency: "NGN", startedAt: "2026-06-01T00:00:00Z", currentAmountMinor: 300_000, renewsAt: "2026-11-25T00:00:00Z", ...over,
});

describe("buildChangeEntries", () => {
  it("records old and new amount per plan/interval for changed prices only", () => {
    const next = withNg({ monthly: { ...ng(DEFAULT_PRICE_BOOK).monthly, STARTER: 3500 } });
    expect(buildChangeEntries(DEFAULT_PRICE_BOOK, next)).toEqual([{ groupId: "NG", plan: "STARTER", interval: "monthly", currency: "NGN", provider: "PAYSTACK", oldAmount: 3000, newAmount: 3500 }]);
  });
  it("records a removed yearly price as null, ignores a newly offered one and currency switches", () => {
    const g = ng(DEFAULT_PRICE_BOOK);
    const removed = withNg({ yearly: { ...g.yearly, STARTER: null } });
    expect(buildChangeEntries(DEFAULT_PRICE_BOOK, removed)).toEqual([expect.objectContaining({ plan: "STARTER", interval: "yearly", oldAmount: 30000, newAmount: null })]);
    expect(buildChangeEntries(removed, DEFAULT_PRICE_BOOK)).toEqual([]);
    expect(buildChangeEntries(DEFAULT_PRICE_BOOK, withNg({ currency: "USD", provider: "STRIPE" }))).toEqual([]);
  });
});

describe("priceAtNextRenewal", () => {
  const book = withNg({ monthly: { ...ng(DEFAULT_PRICE_BOOK).monthly, STARTER: 3500 } });

  it("next_renewal: effective now, so the very next renewal is at the new price", () => {
    const r = priceAtNextRenewal(sub(), book, [change({})], NOW);
    expect(r).toMatchObject({ changes: true, currentAmount: 3000, nextAmount: 3500, takesEffectAt: "2026-11-25T00:00:00.000Z", changeId: "c1" });
    expect(nextPriceNotice(r, "monthly")).toBe("Your price changes to ₦3,500/month on November 25, 2026.");
  });
  it("renewal before the effective date is charged as before", () => {
    const c = change({ effectiveFrom: "2026-12-01T00:00:00Z", existingSubscribers: { when: "from_date", effectiveFrom: "2026-12-01" } });
    const r = priceAtNextRenewal(sub({ renewsAt: "2026-11-30T23:59:59Z" }), book, [c], NOW);
    expect(r.changes).toBe(false);
    expect(r.nextAmount).toBe(3000);
    expect(r.effectiveFrom).toBe("2026-12-01T00:00:00Z");
  });
  it("renewal exactly on the effective date, and after it, is at the new price", () => {
    const c = change({ effectiveFrom: "2026-12-01T00:00:00Z" });
    expect(priceAtNextRenewal(sub({ renewsAt: "2026-12-01T00:00:00Z" }), book, [c], NOW).changes).toBe(true);
    expect(priceAtNextRenewal(sub({ renewsAt: "2026-12-20T00:00:00Z" }), book, [c], NOW).nextAmount).toBe(3500);
  });
  it("yearly subscribers move at their yearly renewal, monthly ones are untouched by a yearly change", () => {
    const yc = change({ interval: "yearly", oldAmount: 30000, newAmount: 36000, effectiveFrom: "2026-11-01T00:00:00Z" });
    expect(priceAtNextRenewal(sub({ interval: "yearly", currentAmountMinor: 3_000_000, renewsAt: "2027-02-01T00:00:00Z" }), book, [yc], NOW)).toMatchObject({ changes: true, nextAmount: 36000 });
    expect(priceAtNextRenewal(sub({ interval: "monthly" }), book, [yc], NOW).changes).toBe(false);
  });
  it("overlapping changes: the latest effective one in force at the renewal wins", () => {
    const a = change({ id: "a", version: 1, newAmount: 3500, effectiveFrom: "2026-12-01T00:00:00Z" });
    const b = change({ id: "b", version: 2, createdAt: "2026-11-05T00:00:00Z", oldAmount: 3500, newAmount: 4000, effectiveFrom: "2027-01-01T00:00:00Z" });
    expect(priceAtNextRenewal(sub({ renewsAt: "2026-12-10T00:00:00Z" }), book, [a, b], NOW)).toMatchObject({ nextAmount: 3500, changeId: "a" });
    expect(priceAtNextRenewal(sub({ renewsAt: "2027-01-10T00:00:00Z" }), book, [a, b], NOW)).toMatchObject({ nextAmount: 4000, changeId: "b" });
    // a later-saved change with an earlier date still loses to the later date once both are in force
    const c = change({ id: "c", version: 3, createdAt: "2026-11-06T00:00:00Z", newAmount: 3800, effectiveFrom: "2026-12-05T00:00:00Z" });
    expect(priceAtNextRenewal(sub({ renewsAt: "2027-01-10T00:00:00Z" }), book, [a, b, c], NOW).changeId).toBe("b");
  });
  it("a change already applied to them, or saved before they subscribed, doesn't apply", () => {
    const c = change({});
    expect(priceAtNextRenewal(sub({ appliedKey: "2026-11-01T00:00:00Z#00000001" }), book, [c], NOW).changes).toBe(false);
    expect(priceAtNextRenewal(sub({ startedAt: "2026-11-02T00:00:00Z", currentAmountMinor: 350_000 }), book, [c], NOW).changes).toBe(false);
  });
  it("a subscriber already paying the new amount isn't a change", () => {
    expect(priceAtNextRenewal(sub({ currentAmountMinor: 350_000 }), book, [change({})], NOW).changes).toBe(false);
  });
  it("removed price list, changed currency, cancelling and cancelled changes", () => {
    const gone: PriceBook = { ...book, groups: book.groups.filter((g) => g.id !== "NG") };
    expect(priceAtNextRenewal(sub(), gone, [change({})], NOW).reason).toBe("group_removed");
    expect(priceAtNextRenewal(sub({ currency: "USD" }), book, [change({})], NOW).reason).toBe("currency_changed");
    expect(priceAtNextRenewal(sub({ cancelling: true }), book, [change({})], NOW).reason).toBe("cancelling");
    expect(priceAtNextRenewal(sub(), book, [change({ status: "cancelled" })], NOW).changes).toBe(false);
  });
  it("removed yearly: left on their yearly price unless the admin confirmed the move to monthly", () => {
    const g = ng(DEFAULT_PRICE_BOOK);
    const noYearly = withNg({ yearly: { ...g.yearly, STARTER: null } });
    const yc = change({ interval: "yearly", oldAmount: 30000, newAmount: null });
    const s = sub({ interval: "yearly", currentAmountMinor: 3_000_000, renewsAt: "2027-02-01T00:00:00Z" });
    expect(priceAtNextRenewal(s, noYearly, [yc], NOW)).toMatchObject({ reason: "yearly_removed", changes: false });
    expect(priceAtNextRenewal(s, noYearly, [{ ...yc, moveRemovedYearlyToMonthly: true }], NOW)).toMatchObject({ changes: true, nextAmount: 3000, nextInterval: "monthly" });
  });
  it("a stale renewal date counts as 'as soon as it renews'", () => {
    expect(priceAtNextRenewal(sub({ renewsAt: "2026-11-01T00:00:00Z" }), book, [change({ effectiveFrom: "2026-11-10T00:00:00Z" })], NOW).changes).toBe(true);
  });
});

describe("resolveEffectiveFrom / summarizeImpact", () => {
  it("defaults to now; a chosen date wins", () => {
    expect(resolveEffectiveFrom({ when: "next_renewal" }, "2026-11-17T10:00:00.000Z")).toBe("2026-11-17T10:00:00.000Z");
    expect(resolveEffectiveFrom({ when: "from_date", effectiveFrom: "2026-12-01" }, "x")).toBe("2026-12-01T00:00:00.000Z");
  });
  it("counts who moves per price list and plan, and the first charge date", () => {
    const next = withNg({ monthly: { ...ng(DEFAULT_PRICE_BOOK).monthly, STARTER: 3500 } });
    const row = previewChange(DEFAULT_PRICE_BOOK, next, { when: "from_date", effectiveFrom: "2026-12-01" }, NOW);
    const subs = [
      { id: "a", ...sub({ renewsAt: "2026-11-20T00:00:00Z" }) },
      { id: "b", ...sub({ renewsAt: "2026-12-05T00:00:00Z" }) },
      { id: "c", ...sub({ renewsAt: "2026-12-20T00:00:00Z" }) },
    ];
    const r = summarizeImpact(subs, next, [row], NOW);
    expect(r.total).toBe(2);
    expect(r.firstChargeAt).toBe("2026-12-05T00:00:00.000Z");
    expect(r.rows).toEqual([expect.objectContaining({ groupId: "NG", plan: "STARTER", count: 2, oldAmount: 3000, newAmount: 3500 })]);
  });
});
