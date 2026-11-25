import { afterEach, describe, expect, it, vi } from "vitest";
import { PLAN_MONTHLY_AI_USD, firstSiteGrantCredits, planMonthlyCredits } from "@/lib/credits/value";
import { creditsForCompletedTopup } from "@/lib/credits/topupOffer";
import type Stripe from "stripe";
import { DEFAULT_PRICE_BOOK, creditsForTopupAmount, regionById } from "@/lib/billing/pricing";

// The AI value of each plan and of credit top-ups (lib/credits/value.ts): credits are always
// AI dollars ÷ the credit rate ($0.001 by default, 1,000 credits per $1).

afterEach(() => vi.unstubAllEnvs());

const world = regionById(DEFAULT_PRICE_BOOK, "WORLD")!;
const ng = regionById(DEFAULT_PRICE_BOOK, "NG")!;

describe("AI credit value", () => {
  it("grants each plan its monthly AI dollars in credits", () => {
    expect(PLAN_MONTHLY_AI_USD).toEqual({ FREE: 0.2, STARTER: 1, PRO: 2, ENTERPRISE: 3 });
    expect(planMonthlyCredits("FREE")).toBe(200);
    expect(planMonthlyCredits("STARTER")).toBe(1_000);
    expect(planMonthlyCredits("PRO")).toBe(2_000);
    expect(planMonthlyCredits("ENTERPRISE")).toBe(3_000);
    expect(planMonthlyCredits("ULTRA")).toBe(2_000); // retired name reads as Pro
  });

  it("the one-time first-site gift is $0.60 of AI, three times a Free month", () => {
    expect(firstSiteGrantCredits()).toBe(600);
    vi.stubEnv("CREDIT_USD_VALUE", "0.002");
    expect(firstSiteGrantCredits()).toBe(300);
  });

  it("top-ups are $1 per 1,000 credits (NGN 1,500 in Nigeria)", () => {
    expect(creditsForTopupAmount(20, "USD", world)).toBe(20_000);
    expect(creditsForTopupAmount(1_500, "NGN", ng)).toBe(1_000);
    expect(creditsForTopupAmount(20, "USD", ng)).toBeNull(); // wrong currency for the region
  });

  it("follows the credit rate if it changes", () => {
    vi.stubEnv("CREDIT_USD_VALUE", "0.01");
    expect(planMonthlyCredits("PRO")).toBe(200);
  });

  it("grants from what was actually paid, before tax", () => {
    const session = (amount_total: number, tax = 0, currency = "usd") => ({ currency, amount_total, total_details: { amount_tax: tax } }) as unknown as Stripe.Checkout.Session;
    expect(creditsForCompletedTopup(session(2000), DEFAULT_PRICE_BOOK)).toBe(20_000);
    expect(creditsForCompletedTopup(session(2150, 150), DEFAULT_PRICE_BOOK)).toBe(20_000);
    expect(creditsForCompletedTopup(session(1500), DEFAULT_PRICE_BOOK)).toBe(15_000);
    expect(creditsForCompletedTopup(session(2000, 0, "eur"), DEFAULT_PRICE_BOOK)).toBeNull();
  });
});
