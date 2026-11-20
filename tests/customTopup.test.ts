import { describe, expect, it } from "vitest";
import {
  calculateCustomTopup,
  creditsForTopupAmount,
  currencySymbolFor,
  DEFAULT_PRICE_BOOK,
  minTopupAmount,
} from "@/lib/billing/pricing";

describe("Custom top-up pricing and credits calculation", () => {
  const ngGroup = DEFAULT_PRICE_BOOK.groups.find((g) => g.id === "NG")!;
  const worldGroup = DEFAULT_PRICE_BOOK.groups.find((g) => g.id === "WORLD")!;

  it("calculates credits for custom amounts in Nigeria (NGN)", () => {
    // ₦1,000 at ₦1,500 per 1,000 credits gives 667 credits
    const topup1000 = calculateCustomTopup(1000, ngGroup);
    expect(topup1000.valid).toBe(true);
    expect(topup1000.credits).toBe(667);
    expect(topup1000.amountMinor).toBe(100000);

    // ₦1,500 gives exactly 1,000 credits
    const topup1500 = calculateCustomTopup(1500, ngGroup);
    expect(topup1500.valid).toBe(true);
    expect(topup1500.credits).toBe(1000);

    // ₦3,000 gives 2,000 credits
    const topup3000 = calculateCustomTopup(3000, ngGroup);
    expect(topup3000.valid).toBe(true);
    expect(topup3000.credits).toBe(2000);
  });

  it("calculates credits for custom amounts in USD (Rest of World)", () => {
    // $2 at $1 per 1,000 credits gives 2,000 credits
    const topup2 = calculateCustomTopup(2, worldGroup);
    expect(topup2.valid).toBe(true);
    expect(topup2.credits).toBe(2000);
    expect(topup2.amountMinor).toBe(200);

    // $5 gives 5,000 credits
    const topup5 = calculateCustomTopup(5, worldGroup);
    expect(topup5.valid).toBe(true);
    expect(topup5.credits).toBe(5000);
  });

  it("enforces minimum top-up thresholds per currency", () => {
    expect(minTopupAmount("NGN")).toBe(100);
    expect(minTopupAmount("USD")).toBe(1);
    expect(minTopupAmount("KES")).toBe(10);
    expect(minTopupAmount("ZAR")).toBe(5);
    expect(minTopupAmount("GHS")).toBe(1);

    const invalidNg = calculateCustomTopup(50, ngGroup);
    expect(invalidNg.valid).toBe(false);
    expect(invalidNg.credits).toBe(0);

    const invalidWorld = calculateCustomTopup(0.5, worldGroup);
    expect(invalidWorld.valid).toBe(false);
    expect(invalidWorld.credits).toBe(0);
  });

  it("formats currency symbols accurately", () => {
    expect(currencySymbolFor("NGN")).toBe("₦");
    expect(currencySymbolFor("USD")).toBe("$");
    expect(currencySymbolFor("GHS")).toBe("GH₵");
    expect(currencySymbolFor("KES")).toBe("KSh ");
    expect(currencySymbolFor("ZAR")).toBe("R ");
  });
});

import { maxTopupAmount, calculateCustomTopup as calcForMax } from "@/lib/billing/pricing";
describe("custom top-up upper limit", () => {
  it("each currency has a cap, and an amount above it is not valid", () => {
    expect(maxTopupAmount("USD")).toBe(500);
    expect(maxTopupAmount("NGN")).toBeGreaterThan(maxTopupAmount("USD"));
    const region = { id: "us", currency: "USD", topupPer1000Credits: 1 } as unknown as Parameters<typeof calcForMax>[1];
    expect(calcForMax(500, region).valid).toBe(true);
    expect(calcForMax(501, region).valid).toBe(false);
  });
});
