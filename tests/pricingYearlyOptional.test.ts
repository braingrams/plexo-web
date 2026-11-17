import { describe, expect, it } from "vitest";

import { DEFAULT_PRICE_BOOK, anyYearlyOffered, planPrice, planPriceMinor, planPriceView, pricingView, validatePriceBook, yearlyOffered, type PriceBook } from "@/lib/billing/pricing";

const ng = DEFAULT_PRICE_BOOK.groups.find((g) => g.id === "NG")!;
const bookWith = (yearly: typeof ng.yearly): PriceBook => ({ ...DEFAULT_PRICE_BOOK, groups: DEFAULT_PRICE_BOOK.groups.map((g) => (g.id === "NG" ? { ...g, yearly } : g)) });

describe("yearly pricing is optional and independent of monthly", () => {
  it("no yearly entry = monthly only; saving is allowed", () => {
    const book = bookWith({ PRO: 75_000 });
    expect(validatePriceBook(book)).toEqual([]);
    const g = book.groups.find((x) => x.id === "NG")!;
    expect(yearlyOffered(g, "STARTER")).toBe(false);
    expect(yearlyOffered(g, "PRO")).toBe(true);
    expect(planPrice(g, "STARTER", "yearly")).toBeNull();
    expect(() => planPriceMinor(g, "STARTER", "yearly")).toThrow(/isn't offered yearly/);
    expect(planPriceView(g, "STARTER")).toMatchObject({ yearly: null, yearlyLabel: null, yearlySavingPercent: 0, yearlyMonthsFree: 0 });
  });
  it("null and 0 mean not offered; no yearly at all hides the switch", () => {
    const g = bookWith({ STARTER: null, PRO: 0 }).groups.find((x) => x.id === "NG")!;
    expect(anyYearlyOffered(g)).toBe(false);
    expect(pricingView(g).yearlyAvailable).toBe(false);
  });
  it("any yearly amount is valid — equal to, or above, 12x monthly — and the saving is information only", () => {
    const g = bookWith({ STARTER: 36_000, PRO: 200_000 }).groups.find((x) => x.id === "NG")!;
    expect(validatePriceBook(bookWith({ STARTER: 36_000, PRO: 200_000 }))).toEqual([]);
    expect(planPriceView(g, "STARTER").yearlySavingPercent).toBe(0);
    expect(planPriceView({ ...g, yearly: { STARTER: 30_000 } }, "STARTER")).toMatchObject({ yearlySavingPercent: 17, yearlyMonthsFree: 2 });
  });
  it("a yearly price that IS set must still be a positive number", () => {
    expect(validatePriceBook(bookWith({ STARTER: -5 })).join(" ")).toMatch(/yearly price must be more than zero/);
  });
});
