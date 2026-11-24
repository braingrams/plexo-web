import { describe, expect, it } from "vitest";
import {
  afterCreateHref, afterFork, appHref, createArgs, defaultSiteName, designPicks, limitNote, MORE_WAYS, MOVE_PATH, NEW_SITE_GOALS, newSiteRedirect, parseCreateRequest, STARTS,
} from "../lib/dashboardV3/newSite";

describe("fork", () => {
  it("has two big choices", () => expect(STARTS.map((s) => s.id)).toEqual(["new", "move"]));
  it("moving goes straight to the move, new goes on to what it is for", () => {
    expect(afterFork("move")).toEqual({ kind: "go", href: MOVE_PATH });
    expect(afterFork("new")).toEqual({ kind: "goal" });
  });
  it("more ways no longer lists WordPress, keeps the rest", () => {
    expect(MORE_WAYS.map((w) => w.id)).toEqual(["upload", "app", "sol"]);
    expect(MORE_WAYS.some((w) => /wordpress/i.test(w.title))).toBe(false);
  });
});

describe("goals and names", () => {
  it("offers the seven goals", () => expect(NEW_SITE_GOALS).toHaveLength(7));
  it("uses the brand name, differently when it is taken", () => {
    expect(defaultSiteName("Ama's Kitchen", "store", [])).toBe("Ama's Kitchen");
    expect(defaultSiteName("Ama's Kitchen", "store", ["ama's kitchen"])).toBe("Ama's Kitchen Shop");
    expect(defaultSiteName("Ama's Kitchen", "store", ["Ama's Kitchen", "Ama's Kitchen Shop"])).toBe("Ama's Kitchen Shop 2");
    expect(defaultSiteName("Ama", "business-site", ["Ama"])).toBe("Ama 2");
    expect(defaultSiteName(undefined, "blog", [])).toBe("My blog");
  });
});

describe("create", () => {
  it("validates", () => {
    expect(parseCreateRequest({ goal: "app", name: "x" }).ok).toBe(false);
    expect(parseCreateRequest({ goal: "store", name: "  " }).ok).toBe(false);
    expect(parseCreateRequest({ goal: "store", name: " Ama  Shop ", designId: "home-shop" })).toEqual({ ok: true, value: { goal: "store", name: "Ama Shop", designId: "home-shop" } });
  });
  it("builds the same site_create args onboarding does, with this site's name", () => {
    const a = createArgs({ goal: "store", name: "Ama Shop", designId: "" }, { name: "Ama", colors: ["#E4572E"] });
    expect(a?.goal).toBe("store");
    expect((a?.brief as { name: string; colors?: string[] }).name).toBe("Ama Shop");
    expect((a?.brief as { colors?: string[] }).colors).toEqual(["#E4572E"]);
  });
  it("picks three designs for a goal", () => {
    const p = designPicks("blog", "Notes");
    expect(p.top).toHaveLength(3);
    expect(p.total).toBeGreaterThanOrEqual(3);
  });
  it("app goal goes to SOL", () => expect(appHref("Tabs")).toContain("/dashboard/sol?new=1&draft="));
});

describe("plan wording", () => {
  it("is silent while there is room", () => {
    expect(limitNote("FREE", [])).toBeNull();
    expect(limitNote("PRO", ["a"])).toBeNull();
  });
  it("tells Free the truth: build now, one online at a time", () => {
    const n = limitNote("FREE", ["My shop"]);
    expect(n?.text).toContain("You can make this website now");
    expect(n?.text).toContain('"My shop" is online');
    expect(n?.text).toContain("nothing is deleted");
    expect(n?.upgradeHref).toBe("/dashboard/settings/subscription");
  });
});

describe("/dashboard/new redirect", () => {
  it("sends new-dashboard people to the new flow, keeps classic and old users", () => {
    expect(newSiteRedirect({ newDashboard: true })).toBe("/dashboard/sites/new");
    expect(newSiteRedirect({ newDashboard: true, classic: "1" })).toBeNull();
    expect(newSiteRedirect({ newDashboard: false })).toBeNull();
  });
});

import { MARKET_RETURN_PATH, PAID_RETRY, paidDesignFrom, readPending } from "../lib/dashboardV3/newSite";
import { onboardingReturnPath } from "../lib/onboarding/marketDesigns";

describe("marketplace designs in the new flow", () => {
  it("accepts a marketplace design id when creating", () => {
    expect(parseCreateRequest({ goal: "store", name: "Ama", marketDesignId: " d1 " })).toEqual({ ok: true, value: { goal: "store", name: "Ama", designId: "", marketDesignId: "d1" } });
  });
  it("Stripe returns to this page, which the server allows", () => {
    expect(onboardingReturnPath(MARKET_RETURN_PATH, "d1")).toBe("/dashboard/sites/new?paidDesign=d1");
    expect(onboardingReturnPath("/dashboard/sites/new/evil", "d1")).toBeNull();
    expect(onboardingReturnPath("https://evil.example/dashboard/sites/new", "d1")).toBeNull();
  });
  it("waits about 16 seconds for the payment to be recorded", () => expect(PAID_RETRY.tries * PAID_RETRY.delayMs).toBe(16000));
  it("reads the paid design and what was typed before paying", () => {
    expect(paidDesignFrom("?paidDesign=abc-1")).toBe("abc-1");
    expect(paidDesignFrom("?paidDesign=a/b")).toBeNull();
    expect(paidDesignFrom("")).toBeNull();
    expect(readPending(JSON.stringify({ goal: "blog", name: " My  notes " }))).toEqual({ goal: "blog", name: "My notes" });
    expect(readPending(JSON.stringify({ goal: "app", name: "x" }))).toBeNull();
    expect(readPending("nope")).toBeNull();
  });
});

describe("where the owner lands after creating the site", () => {
  it("a site SOL personalized goes to the dashboard, where Finish up and Publish are waiting", () => {
    expect(afterCreateHref("abc", true)).toBe("/dashboard");
  });
  it("any other new site opens its own page, where the pages and the editor are", () => {
    expect(afterCreateHref("abc", false)).toBe("/dashboard/sites/abc");
  });
});
