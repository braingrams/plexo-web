import { describe, expect, it } from "vitest";

import { getTierFeatures } from "@/lib/subscription";
import { effectivePlan } from "@/lib/plan/entitlement";
import { mapLegacyPlan, normalizeStoredPlan, toPlanId } from "@/lib/plan/plans";
import { planFromStripeSubscription } from "@/lib/billing/stripePlans";
import {
  DEFAULT_PRICE_BOOK,
  currencyChoices,
  formatMoney,
  groupForCountry,
  planPrice,
  resolvePriceRegion,
  validatePriceBook,
  type PriceBook,
  type PriceGroup,
} from "@/lib/billing/pricing";
import { billingRegionFor, pricingViewFor, regionLockFields } from "@/lib/billing/region";

describe("entitlements per plan", () => {
  it("Free: one page, no funnels, no commerce, subdomain only, badge shown", () => {
    expect(getTierFeatures("FREE")).toMatchObject({ maxPublishedSites: 1, maxPublishedPagesPerSite: 1, includedFunnelSlots: 0, maxCommerceProducts: 0, maxEmailTemplates: 1, customDomainEnabled: false, brandingRemovalEnabled: false, teamSeats: 0 });
  });
  it("Starter: one multi-page site, 1 funnel, 1 custom domain, 5 email templates, 2 seats", () => {
    expect(getTierFeatures("STARTER")).toMatchObject({ maxPublishedSites: 1, multiPageSitesEnabled: true, includedFunnelSlots: 1, maxCommerceProducts: 1_000, maxEmailTemplates: 5, maxCustomDomains: 1, includedFreeDomains: 0, brandingRemovalEnabled: true, whiteLabelEnabled: false, teamSeats: 2, ssrEnabled: false });
  });
  it("Pro: 4 sites, 3 funnels, 5,000 products, 3 custom domains + 1 free, 5 seats, server apps", () => {
    expect(getTierFeatures("PRO")).toMatchObject({ maxPublishedSites: 4, includedFunnelSlots: 3, maxCommerceProducts: 5_000, maxEmailTemplates: 20, maxCustomDomains: 3, includedFreeDomains: 1, whiteLabelEnabled: false, teamSeats: 5, ssrEnabled: true });
  });
  it("Enterprise: unlimited sites, 10,000 products, white-label (the only plan with it)", () => {
    expect(getTierFeatures("ENTERPRISE")).toMatchObject({ maxPublishedSites: null, maxCommerceProducts: 10_000, whiteLabelEnabled: true, includedFreeDomains: 1 });
    for (const p of ["FREE", "STARTER", "PRO"]) expect(getTierFeatures(p).whiteLabelEnabled).toBe(false);
  });
  it("a trial withholds custom domains and white-label", () => {
    expect(getTierFeatures("PRO", { trial: true })).toMatchObject({ customDomainEnabled: false, whiteLabelEnabled: false });
  });
  it("unknown plans fail closed to Free", () => {
    expect(getTierFeatures("MYSTERY")).toEqual(getTierFeatures("FREE"));
  });
});

describe("legacy plan mapping", () => {
  it("old PRO is Starter, old ULTRA is Pro, ENTERPRISE and FREE are unchanged", () => {
    expect(mapLegacyPlan("PRO")).toBe("STARTER");
    expect(mapLegacyPlan("ULTRA")).toBe("PRO");
    expect(mapLegacyPlan("ENTERPRISE")).toBe("ENTERPRISE");
    expect(mapLegacyPlan(null)).toBe("FREE");
  });
  it("planVersion decides what a stored PRO means", () => {
    expect(normalizeStoredPlan("PRO", undefined)).toBe("STARTER");
    expect(normalizeStoredPlan("PRO", 1)).toBe("STARTER");
    expect(normalizeStoredPlan("PRO", 2)).toBe("PRO");
    expect(normalizeStoredPlan("ULTRA", 2)).toBe("PRO");
    expect(toPlanId("ULTRA")).toBe("PRO");
  });
  it("an old Pro subscriber keeps Starter access until migrated, a new Pro is Pro", () => {
    const paid = { subscriptionStatus: "ACTIVE", stripeSubscriptionId: "sub_1" };
    expect(effectivePlan({ ...paid, subscriptionPlan: "PRO" })).toBe("STARTER");
    expect(effectivePlan({ ...paid, subscriptionPlan: "ULTRA" })).toBe("PRO");
    expect(effectivePlan({ ...paid, subscriptionPlan: "PRO", planVersion: 2 })).toBe("PRO");
    expect(effectivePlan({ subscriptionPlan: "PRO", planVersion: 2 })).toBe("FREE"); // no payment, no access
  });
  it("Stripe metadata reads the same way, forever (webhooks)", () => {
    expect(planFromStripeSubscription({ metadata: { plan: "PRO" } })).toBe("STARTER");
    expect(planFromStripeSubscription({ metadata: { plan: "ULTRA" } })).toBe("PRO");
    expect(planFromStripeSubscription({ metadata: { plan: "PRO", planVersion: "2" } })).toBe("PRO");
    expect(planFromStripeSubscription({ metadata: { plan: "STARTER", planVersion: "2" } })).toBe("STARTER");
    expect(planFromStripeSubscription({ metadata: { kind: "lms_addon_slot", plan: "PRO" } })).toBeNull();
    expect(planFromStripeSubscription({ metadata: {} })).toBeNull();
  });
});

describe("the seeded price book", () => {
  const g = (id: string) => DEFAULT_PRICE_BOOK.groups.find((x) => x.id === id)!;
  it("is valid", () => expect(validatePriceBook(DEFAULT_PRICE_BOOK)).toEqual([]));
  it("has the owner's prices", () => {
    expect([g("NG").provider, g("NG").monthly]).toEqual(["PAYSTACK", { STARTER: 3_000, PRO: 7_500, ENTERPRISE: 39_000 }]);
    expect(g("NG").topupPer1000Credits).toBe(1_500);
    expect(g("GH").monthly).toEqual({ STARTER: 35, PRO: 85, ENTERPRISE: 429 });
    expect(g("KE").monthly).toEqual({ STARTER: 450, PRO: 990, ENTERPRISE: 4_990 });
    expect(g("ZA").monthly).toEqual({ STARTER: 69, PRO: 149, ENTERPRISE: 749 });
    expect([g("AFRICA").provider, g("AFRICA").monthly]).toEqual(["STRIPE", { STARTER: 5, PRO: 12, ENTERPRISE: 59 }]);
    expect(g("WORLD").monthly).toEqual({ STARTER: 9, PRO: 19, ENTERPRISE: 99 });
  });
  it("yearly is two months free", () => {
    expect(planPrice(g("WORLD"), "STARTER", "yearly")).toBe(90);
    expect(planPrice(g("NG"), "PRO", "yearly")).toBe(75_000);
  });
  it("formats money in the local currency", () => {
    expect(formatMoney(3000, "NGN")).toContain("3,000");
    expect(formatMoney(9, "USD")).toContain("9");
  });
});

describe("region resolution", () => {
  const book = DEFAULT_PRICE_BOOK;
  it("picks the group from the viewer's country, defaulting to rest of world", () => {
    expect(groupForCountry(book, "NG").id).toBe("NG");
    expect(groupForCountry(book, "tz").id).toBe("AFRICA");
    expect(groupForCountry(book, "US").id).toBe("WORLD");
    expect(groupForCountry(book, null).id).toBe("WORLD");
    expect(groupForCountry(book, "XX").id).toBe("WORLD");
  });
  it("the country saved at first checkout wins over the request", () => {
    expect(resolvePriceRegion(book, { headerCountry: "US", billingCountry: "NG" }).id).toBe("NG");
  });
  it("the country the owner chose beats the saved billing country and the request's IP", () => {
    expect(resolvePriceRegion(book, { userCountry: "NG", billingCountry: "US", headerCountry: "US" }).id).toBe("NG");
    expect(resolvePriceRegion(book, { userCountry: "us", headerCountry: "NG" }).id).toBe("WORLD");
    expect(resolvePriceRegion(book, { userCountry: "XX", billingCountry: "GH", headerCountry: "US" }).id).toBe("GH");
    expect(resolvePriceRegion(book, { headerCountry: "KE" }).id).toBe("KE"); // IP is only the fallback
  });
  it("'pay in USD instead' switches to the USD list; Africans get the African USD prices", () => {
    expect(resolvePriceRegion(book, { headerCountry: "NG", billingCurrency: "USD" }).id).toBe("AFRICA");
    expect(resolvePriceRegion(book, { headerCountry: "GH", billingCurrency: "USD" }).id).toBe("AFRICA");
    expect(currencyChoices(book, { headerCountry: "NG" })).toMatchObject({ local: { id: "NG" }, usd: { id: "AFRICA" } });
    expect(currencyChoices(book, { headerCountry: "US" })).toBeNull();
  });
  it("a country can leave its group with its own settings (South Africa in USD at its own price)", () => {
    const za: PriceGroup = { ...(book.groups.find((x) => x.id === "WORLD")!), id: "country:ZA", name: "South Africa (USD)", countries: ["ZA"], monthly: { STARTER: 7, PRO: 15, ENTERPRISE: 80 }, yearly: { STARTER: 70, PRO: 150, ENTERPRISE: 800 } };
    const custom: PriceBook = { ...book, groups: [...book.groups.map((x) => (x.id === "ZA" ? { ...x, countries: [] } : x)), za] };
    expect(validatePriceBook(custom)).toEqual([]);
    const r = groupForCountry(custom, "ZA");
    expect(r.id).toBe("country:ZA");
    expect([r.currency, r.provider, planPrice(r, "STARTER", "monthly")]).toEqual(["USD", "STRIPE", 7]);
    expect(groupForCountry(custom, "KE").id).toBe("KE"); // others unaffected
  });
  it("validation catches a country in two groups and a currency the provider can't charge", () => {
    const bad: PriceBook = { ...book, groups: book.groups.map((x) => (x.id === "GH" ? { ...x, countries: ["NG"], provider: "STRIPE" as const } : x)) };
    const errors = validatePriceBook(bad).join(" ");
    expect(errors).toMatch(/NG is in both/);
    expect(errors).toMatch(/Stripe can.t charge in GHS/);
  });
  it("account + headers resolve through billingRegionFor / pricingViewFor", () => {
    const h = new Headers({ "cloudfront-viewer-country": "NG" });
    expect(billingRegionFor(book, null, h).id).toBe("NG");
    expect(billingRegionFor(book, { billingCountry: "US", billingCurrency: "USD" }, h).id).toBe("WORLD");
    // A pre-regional Stripe subscriber stays on USD even from Nigeria.
    expect(billingRegionFor(book, { stripeSubscriptionId: "sub_1", subscriptionStatus: "ACTIVE" }, h).currency).toBe("USD");
    expect(pricingViewFor(book, null, h).currency).toBe("NGN");
  });
  it("an owner's country decides prices, but a running subscription keeps its paid currency", () => {
    const h = new Headers({ "cloudfront-viewer-country": "US" });
    expect(billingRegionFor(book, { country: "NG" }, h).id).toBe("NG");
    expect(pricingViewFor(book, { country: "NG" }, h)).toMatchObject({ currency: "NGN", country: "NG" });
    const paying = { country: "NG", billingCountry: "US", billingCurrency: "USD", subscriptionId: "sub_1", subscriptionStatus: "ACTIVE" };
    expect(billingRegionFor(book, paying, h).id).toBe("WORLD");
    expect(billingRegionFor(book, { country: "NG", billingCountry: "US", subscriptionId: "sub_1", subscriptionStatus: "CANCELED" }, h).id).toBe("NG");
  });
  it("the first checkout locks country and currency; later ones don't rewrite them", () => {
    const h = new Headers({ "cloudfront-viewer-country": "gh" });
    const region = groupForCountry(DEFAULT_PRICE_BOOK, "GH");
    expect(regionLockFields({}, region, h, new Date("2026-11-01T00:00:00Z"))).toMatchObject({ billingCountry: "GH", billingCurrency: "GHS", billingRegion: "GH" });
    expect(regionLockFields({ billingCountry: "GH", billingRegionLockedAt: "x" }, region, h)).toBeNull();
    // The owner's own country is what gets saved, not the IP guess.
    expect(regionLockFields({ country: "NG" }, region, h)).toMatchObject({ billingCountry: "NG" });
  });
});
