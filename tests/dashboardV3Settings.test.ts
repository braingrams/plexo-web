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

import { addressCounts, addressStatus, filterAddresses, groupBySite, NO_FILTERS, relinkDomainValue, switchPlan } from "@/lib/dashboardV3/domainsView";
import type { AddressRow } from "@/lib/dashboardV3/domainsData";

const addr = (o: Partial<AddressRow> & { id: string; domain: string }): AddressRow => ({ type: "SUBDOMAIN", siteId: "s1", siteName: "KayCare", online: true, pausedByPlan: false, bought: false, ...o });
const ROWS = [
  addr({ id: "1", domain: "kaycare.plexopages.com" }),
  addr({ id: "2", domain: "www.kaycare.com", type: "CUSTOM", online: false }),
  addr({ id: "3", domain: "aria.plexopages.com", siteId: "s2", siteName: "Aria", pausedByPlan: true }),
  addr({ id: "4", domain: "aria.com", type: "CUSTOM", siteId: "s2", siteName: "Aria", bought: true }),
];

describe("domains list", () => {
  it("names each address's status", () => {
    expect(ROWS.map(addressStatus)).toEqual(["online", "setting-up", "attention", "online"]);
    expect(addressCounts(ROWS)).toMatchObject({ total: 4, online: 2, "setting-up": 1, attention: 1, own: 2, free: 2 });
  });
  it("searches by address or site, and narrows by site, kind and status", () => {
    expect(filterAddresses(ROWS, { ...NO_FILTERS, q: "WWW.kaycare" }).map((r) => r.id)).toEqual(["1", "2"]);
    expect(filterAddresses(ROWS, { ...NO_FILTERS, q: "aria" }).map((r) => r.id)).toEqual(["3", "4"]);
    expect(filterAddresses(ROWS, { ...NO_FILTERS, kind: "own" }).map((r) => r.id)).toEqual(["2", "4"]);
    expect(filterAddresses(ROWS, { ...NO_FILTERS, siteId: "s2", kind: "free" }).map((r) => r.id)).toEqual(["3"]);
    expect(filterAddresses(ROWS, { ...NO_FILTERS, status: "attention" }).map((r) => r.id)).toEqual(["3"]);
  });
  it("groups by site, needs-a-look first, own addresses first inside", () => {
    const g = groupBySite(ROWS);
    expect(g.map((x) => x.siteName)).toEqual(["Aria", "KayCare"]);
    expect(g[1].rows.map((r) => r.id)).toEqual(["2", "1"]);
  });
});

describe("moving an address to another site", () => {
  const aria = { id: "s2", name: "Aria" };
  it("says what changes, and that the old site keeps its free address", () => {
    const p = switchPlan(ROWS[1], aria, ROWS);
    expect(p.blocked).toBeNull();
    expect(p.lines[0]).toBe("www.kaycare.com will show Aria instead of KayCare.");
    expect(p.lines[1]).toBe("KayCare keeps its free address.");
  });
  it("warns when the old site would be left with no address", () => {
    expect(switchPlan(ROWS[0], aria, [ROWS[0]]).lines[1]).toBe("KayCare will have no web address until you add one.");
  });
  it("refuses a no-op, no target, and bought addresses", () => {
    expect(switchPlan(ROWS[0], { id: "s1", name: "KayCare" }, ROWS).blocked).toMatch(/already shows/);
    expect(switchPlan(ROWS[0], undefined, ROWS).blocked).toBeTruthy();
    expect(switchPlan(ROWS[3], { id: "s1", name: "KayCare" }, ROWS).blocked).toMatch(/bought through Plexo/);
  });
  it("sends a free address as its first part only", () => {
    expect(relinkDomainValue(ROWS[0])).toBe("kaycare");
    expect(relinkDomainValue(ROWS[1])).toBe("www.kaycare.com");
  });
});
