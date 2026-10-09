import { afterEach, describe, expect, it, vi } from "vitest";
import { PLAN_MONTHLY_AI_USD, TOPUP_AI_SHARE, creditsForTopupPayment, planMonthlyCredits } from "@/lib/credits/value";
import { creditsForCompletedTopup } from "@/lib/credits/topupOffer";
import type Stripe from "stripe";

// The AI value of each plan and of credit top-ups (lib/credits/value.ts): credits are always
// AI dollars ÷ the credit rate ($0.001 by default, 1,000 credits per $1).

afterEach(() => vi.unstubAllEnvs());

describe("AI credit value", () => {
  it("grants each plan its monthly AI dollars in credits", () => {
    expect(PLAN_MONTHLY_AI_USD).toEqual({ FREE: 0.2, PRO: 2, ULTRA: 3 });
    expect(planMonthlyCredits("FREE")).toBe(200);
    expect(planMonthlyCredits("PRO")).toBe(2_000);
    expect(planMonthlyCredits("ULTRA")).toBe(3_000);
  });

  it("turns half of a top-up's price into credits", () => {
    expect(TOPUP_AI_SHARE).toBe(0.5);
    expect(creditsForTopupPayment(20)).toBe(10_000);
    expect(creditsForTopupPayment(5)).toBe(2_500);
    expect(creditsForTopupPayment(0.1)).toBe(50);
  });

  it("follows the credit rate if it changes", () => {
    vi.stubEnv("CREDIT_USD_VALUE", "0.01");
    expect(planMonthlyCredits("ULTRA")).toBe(300);
    expect(creditsForTopupPayment(20)).toBe(1_000);
  });

  it("grants from what was actually paid, before tax", () => {
    const session = (amount_total: number, tax = 0, currency = "usd") => ({ currency, amount_total, total_details: { amount_tax: tax } }) as unknown as Stripe.Checkout.Session;
    expect(creditsForCompletedTopup(session(2000))).toBe(10_000);
    expect(creditsForCompletedTopup(session(2150, 150))).toBe(10_000);
    expect(creditsForCompletedTopup(session(1500))).toBe(7_500);
    expect(creditsForCompletedTopup(session(2000, 0, "eur"))).toBeNull();
  });
});
