import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS, settingsSectionOf, settingsTabs }
 from "@/lib/dashboardV3/settingsNav";
import { creditMeter, meterText, usageMeter } from "@/lib/dashboardV3/settingsUsage";
import { isDirty, saveBarState } from "@/lib/dashboardV3/settingsSaveBar";
import { DEFAULT_PRICE_BOOK, pricingView, regionForCurrency } from "@/lib/billing/pricing";
import { billingPlanId, cancelExplanation, creditView, planStatusLine, planView, plansAbove, priceSourceFrom } from "@/lib/dashboardV3/billingView";
import { CONNECT_TOOLS, editorConfig, mcpUrl } from "@/lib/dashboardV3/connectTools";

const ids = (l: { id: string }[]) => l.map((s) => s.id);

describe("settings tabs", () => {
  it("shows every section as a visible tab, most-used first", () => {
    expect(ids(settingsTabs("beginner"))).toEqual(["profile", "plan", "team", "domains", "brand", "notifications", "connect", "moving", "developers"]);
  });
  it("never hides a section, whatever the experience level", () => {
    for (const e of ["beginner", "intermediate", "pro"] as const) expect(settingsTabs(e)).toHaveLength(9);
  });
  it("puts Developers before Move a site for pros, and labels it for everyone", () => {
    const pro = ids(settingsTabs("pro"));
    expect(pro.indexOf("developers")).toBeLessThan(pro.indexOf("moving"));
    expect(SETTINGS_SECTIONS.developers.hint).toBe("For developers");
  });
  it("maps paths to sections", () => {
    expect(settingsSectionOf("/dashboard/settings")).toBe("profile");
    expect(settingsSectionOf("/dashboard/settings/plan/")).toBe("plan");
    expect(settingsSectionOf("/dashboard/settings/branding")).toBe("brand");
    expect(settingsSectionOf("/dashboard/settings/developers")).toBe("developers");
  });
});

describe("usage meters", () => {
  it("calculates share, tone and what is left", () => {
    expect(usageMeter(1, 4)).toMatchObject({ pct: 25, tone: "ok", remaining: 3 });
    expect(usageMeter(4, 5)).toMatchObject({ pct: 80, tone: "near" });
    expect(usageMeter(5, 5)).toMatchObject({ pct: 100, tone: "full", remaining: 0 });
    expect(usageMeter(9, 5).pct).toBe(100);
  });
  it("treats null as unlimited and 0 as not on the plan", () => {
    expect(usageMeter(40, null)).toMatchObject({ limit: null, tone: "ok", pct: 0 });
    expect(meterText(usageMeter(2, 0))).toBe("Not on your plan");
    expect(meterText(usageMeter(2, null))).toBe("2, no limit");
  });
  it("writes plain counts", () => {
    expect(meterText(usageMeter(2, 4), { one: "site", many: "sites" })).toBe("2 of 4 sites");
    expect(meterText(usageMeter(1, 1), { one: "site", many: "sites" })).toBe("1 of 1 site");
  });
  it("turns what's left of the monthly credits into what's used", () => {
    expect(creditMeter(300, 2000)).toMatchObject({ used: 1700, pct: 85, tone: "near" });
    expect(creditMeter(5000, 2000).used).toBe(0);
    expect(creditMeter(0, 0).tone).toBe("ok");
  });
});

describe("save bar", () => {
  it("is hidden until something changes", () => {
    expect(saveBarState({ dirty: false })).toEqual({ visible: false, canSave: false, canDiscard: false });
  });
  it("shows with Save ready as soon as there is a valid change", () => {
    expect(saveBarState({ dirty: true })).toEqual({ visible: true, canSave: true, canDiscard: true });
  });
  it("blocks Save on an invalid change but still lets people discard", () => {
    expect(saveBarState({ dirty: true, valid: false })).toEqual({ visible: true, canSave: false, canDiscard: true });
  });
  it("stays visible and locked while saving", () => {
    expect(saveBarState({ dirty: true, saving: true })).toEqual({ visible: true, canSave: false, canDiscard: false });
  });
  it("detects changes against what was saved", () => {
    expect(isDirty({ name: "Ama" }, { name: "Ama" })).toBe(false);
    expect(isDirty({ name: "Ama" }, { name: "Ama O" })).toBe(true);
    expect(isDirty({ email: "" }, { email: "" })).toBe(false);
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
