import { describe, expect, it } from "vitest";
import { settingsLayout, settingsSectionOf } from "@/lib/dashboardV3/settingsNav";
import { DEFAULT_PRICE_BOOK, pricingView, regionForCurrency } from "@/lib/billing/pricing";
import { billingPlanId, cancelExplanation, creditView, planStatusLine, planView, plansAbove, priceSourceFrom } from "@/lib/dashboardV3/billingView";
import { CONNECT_TOOLS, editorConfig, mcpUrl } from "@/lib/dashboardV3/connectTools";

const ids = (l: { id: string }[]) => l.map((s) => s.id);

describe("settings layout by experience", () => {
  it("beginners see three sections, the rest under More", () => {
    const l = settingsLayout("beginner");
    expect(ids(l.primary)).toEqual(["profile", "plan", "notifications"]);
    expect(ids(l.more)).toEqual(["team", "domains", "connect", "moving"]);
    expect(ids(l.developer)).toEqual(["developers"]);
  });
  it("pros get developer tools up front, others a collapsed group", () => {
    expect(ids(settingsLayout("pro").primary)).toContain("developers");
    expect(settingsLayout("pro").developer).toEqual([]);
    expect(ids(settingsLayout("intermediate").primary)).not.toContain("developers");
  });
  it("maps paths to sections", () => {
    expect(settingsSectionOf("/dashboard/settings")).toBe("profile");
    expect(settingsSectionOf("/dashboard/settings/plan/")).toBe("plan");
    expect(settingsSectionOf("/dashboard/settings/developers")).toBe("developers");
  });
});

describe("billing view", () => {
  it("uses plain plan names and optional prices", () => {
    expect(planView("STARTER").name).toBe("Starter");
    expect(planView("PRO", { PRO: "$19 a month" }).price).toBe("$19 a month");
    expect(planView("STARTER").price).toBeNull();
    expect(planView("FREE").included.join(" ")).not.toMatch(/SDK|DNS|template/i);
  });
  it("reads the retired Ultra plan as Pro", () => {
    expect(billingPlanId("ULTRA")).toBe("PRO");
    expect(billingPlanId("nonsense")).toBe("FREE");
  });
  it("takes prices from the price book in the person's currency", () => {
    const pricing = pricingView(regionForCurrency(DEFAULT_PRICE_BOOK, "NGN") ?? DEFAULT_PRICE_BOOK.groups[0]);
    const prices = priceSourceFrom(pricing);
    expect(prices.STARTER).toBe(`${pricing.plans.STARTER.monthlyLabel} a month`);
    expect(prices.ENTERPRISE).toMatch(/^from /);
    expect(priceSourceFrom(null)).toEqual({});
  });
  it("offers only plans above the current one", () => {
    expect(plansAbove("FREE")).toEqual(["STARTER", "PRO", "ENTERPRISE"]);
    expect(plansAbove("ENTERPRISE")).toEqual([]);
  });
  it("explains status and cancelling", () => {
    expect(planStatusLine({ plan: "FREE", paying: false })).toMatch(/Free/);
    expect(planStatusLine({ plan: "STARTER", paying: true, basis: "TRIAL", daysLeft: 1 })).toMatch(/1 day left/);
    expect(cancelExplanation({ plan: "STARTER", paying: true })).toMatch(/Nothing is deleted/);
    expect(cancelExplanation({ plan: "FREE", paying: false })).toBeNull();
    expect(cancelExplanation({ plan: "STARTER", paying: true, endsAt: "2026-12-01" })).toBeNull();
  });
  it("summarises credits", () => {
    const c = creditView(50, 20, new Date(Date.now() + 3 * 86_400_000).toISOString());
    expect(c.total).toBe(70);
    expect(c.low).toBe(true);
    expect(c.resetsInDays).toBe(3);
    expect(creditView(-5, 0, new Date().toISOString()).negative).toBe(true);
  });
});

describe("connect tools", () => {
  it("one card per tool with exactly three steps", () => {
    expect(CONNECT_TOOLS.map((t) => t.id)).toEqual(["claude", "chatgpt", "cursor"]);
    for (const t of CONNECT_TOOLS) expect(t.steps).toHaveLength(3);
  });
  it("builds the link and editor config", () => {
    expect(mcpUrl("https://x.com/")).toBe("https://x.com/api/v1/mcp");
    expect(JSON.parse(editorConfig("https://x.com", "k")).mcpServers.plexo.env.PLEXO_API_KEY).toBe("k");
  });
});
