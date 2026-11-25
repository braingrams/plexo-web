import { describe, expect, it, vi } from "vitest";
import { PLAN_GATE_CODES, parsePlanGate, planGateBody, isActionGateFailure, markGateShown, isGateShown } from "@/lib/plan/planGate";
import { blogLimitGate, domainCountGate, funnelSlotsGate, planGateMessage, templateLimitGate } from "@/lib/plan/limitGates";
import { planThatEnables, planThatRaises } from "@/lib/plan/planNeeded";
import { commerceSettingsGate, productLimitGate } from "@/lib/plan/commerceGate";
import { customDomainRequiredPlan } from "@/lib/plan/domainGate";
import { creditUpgradeOffer, aiRefusalBody, outOfCreditsSentence } from "@/lib/credits/upgradeOffer";
import { planMonthlyCredits } from "@/lib/credits/value";
import { getTierFeatures } from "@/lib/subscription";

vi.mock("@/lib/db/commerceEntities", () => ({ CommerceProduct: {} }));
vi.mock("@/lib/plan/workspacePlan", () => ({ planFromOwner: () => ({}), workspaceOwner: async () => ({}) }));

describe("every plan-gate code round-trips into what the dashboard shows", () => {
  for (const code of PLAN_GATE_CODES) {
    it(code, () => {
      const gate = parsePlanGate(planGateBody(code, "Plain words.", "PRO"));
      expect(gate).toMatchObject({ code, message: "Plain words.", requiredPlan: "PRO" });
    });
  }
});

describe("the plan that lifts a limit is one that actually helps", () => {
  it("never points Starter at Starter", () => {
    expect(planThatRaises((f) => f.maxLandingPages, getTierFeatures("STARTER").maxLandingPages)).toBe("PRO");
    expect(planThatRaises((f) => f.maxLandingPages, getTierFeatures("FREE").maxLandingPages)).toBe("STARTER");
    expect(planThatEnables((f) => f.ownPaymentKeysEnabled)).toBe("PRO");
    expect(planThatEnables((f) => f.commerceEnabled)).toBe("STARTER");
  });
  it("templates: sites and emails", () => {
    const site = templateLimitGate("LANDING_PAGE", 5);
    expect(site).toMatchObject({ code: "PLAN_TEMPLATE_LIMIT", requiredPlan: "STARTER" });
    expect(templateLimitGate("EMAIL", 5).requiredPlan).toBe("PRO");
    expect(site.message).not.toMatch(/403|undefined/);
  });
  it("funnel slots: none on Free needs Starter, a full plan needs the next, and a slot can be bought", () => {
    expect(funnelSlotsGate(0, 0)).toMatchObject({ code: "PLAN_FUNNEL_SLOTS", requiredPlan: "STARTER", details: { canBuySlot: false } });
    expect(funnelSlotsGate(1, 1)).toMatchObject({ requiredPlan: "PRO", details: { canBuySlot: true } });
  });
  it("domains and blog", () => {
    expect(domainCountGate(1)).toMatchObject({ code: "PLAN_CUSTOM_DOMAIN_LIMIT", requiredPlan: "PRO" });
    expect(blogLimitGate(0)).toMatchObject({ code: "PLAN_BLOG_LIMIT", requiredPlan: "STARTER" });
    expect(customDomainRequiredPlan({ subscriptionPlan: "FREE" })).toBe("STARTER");
    expect(customDomainRequiredPlan({ subscriptionPlan: "STARTER", onTrial: true })).toBe("STARTER");
  });
  it("commerce: enabling, own payment keys and product count each name their plan", () => {
    expect(commerceSettingsGate({ plan: "FREE", onTrial: false }, { enabled: true })).toMatchObject({ code: "PLAN_COMMERCE_LIMIT", requiredPlan: "STARTER" });
    expect(commerceSettingsGate({ plan: "STARTER", onTrial: false }, { paymentProvider: "BYO_STRIPE" })).toMatchObject({ code: "PLAN_OWN_PAYMENT_KEYS", requiredPlan: "PRO" });
    expect(commerceSettingsGate({ plan: "PRO", onTrial: false }, { enabled: true, paymentProvider: "BYO_STRIPE" })).toBeNull();
    expect(productLimitGate({ plan: "STARTER", onTrial: false }, 1000)).toMatchObject({ code: "PLAN_PRODUCT_LIMIT", requiredPlan: "PRO" });
    expect(productLimitGate({ plan: "STARTER", onTrial: false }, 3)).toBeNull();
  });
  it("text-only places get the plan and a link", () => {
    const text = planGateMessage({ message: "Full.", requiredPlan: "PRO" }, "https://app.example");
    expect(text).toContain("Pro");
    expect(text).toContain("https://app.example/dashboard/settings/subscription?upgrade=PRO");
  });
});

describe("running out of credits", () => {
  it("offers the next plan with more credits, using the amounts in lib/credits/value.ts", () => {
    const free = creditUpgradeOffer("FREE");
    expect(free).toEqual({ plan: "STARTER", credits: planMonthlyCredits("STARTER"), currentCredits: planMonthlyCredits("FREE") });
    expect(creditUpgradeOffer("STARTER")?.plan).toBe("PRO");
    expect(creditUpgradeOffer("ENTERPRISE")).toBeNull();
  });
  it("tags the out-of-credits refusal with the three ways forward, leaves others alone", () => {
    const body = aiRefusalBody({ status: 402, error: "SOL needs more credits to do this." });
    expect(body).toMatchObject({ code: "OUT_OF_CREDITS", topUpUrl: expect.any(String), ownKeyUrl: expect.any(String), upgradeUrl: expect.any(String) });
    expect(aiRefusalBody({ status: 403, error: "AI is not enabled for this account." })).toEqual({ error: "AI is not enabled for this account." });
    expect(outOfCreditsSentence("https://x.io")).toMatch(/Top up.*own AI key.*upgrade/i);
  });
});

describe("the safety net only steps in for actions", () => {
  it("ignores page loads", () => {
    expect(isActionGateFailure("POST", 403)).toBe(true);
    expect(isActionGateFailure("PUT", 402)).toBe(true);
    expect(isActionGateFailure("GET", 403)).toBe(false);
    expect(isActionGateFailure(undefined, 403)).toBe(false);
    expect(isActionGateFailure("POST", 500)).toBe(false);
  });
  it("knows which limits a screen is already explaining", () => {
    const done = markGateShown("A limit.");
    expect(isGateShown("A limit.")).toBe(true);
    done();
    expect(isGateShown("A limit.")).toBe(false);
  });
});

import { countsAsSite } from "@/lib/plan/countsAsSite";
describe("what counts as a site for the plan limit", () => {
  it("a site's own top-level page counts; its shared header/footer and layout designs never do", () => {
    expect(countsAsSite({ kind: "LANDING_PAGE" })).toBe(true);
    expect(countsAsSite({ kind: "LANDING_PAGE", parentId: "x" })).toBe(false);
    expect(countsAsSite({ kind: "LANDING_PAGE", isSiteLayoutFragment: true })).toBe(false);
    expect(countsAsSite({ kind: "LANDING_PAGE", isBlogLayout: true })).toBe(false);
    expect(countsAsSite({ kind: "EMAIL" }, "EMAIL")).toBe(true);
  });
});
