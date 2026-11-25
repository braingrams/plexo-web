import { describe, expect, it } from "vitest";
import {
  markSiteJustMade, JUST_MADE_COOKIE, afterCreateHref, afterFork, appHref, createArgs, defaultSiteName, designPicks, limitNote, MORE_WAYS, MOVE_PATH, noticeFor, noticeMessages, readNotice, NEW_SITE_GOALS, newSiteRedirect, parseCreateRequest, STARTS,
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

describe("sites made by upload or WordPress move", () => {
  it("become the current site and are flagged as just made, so Home continues the guided steps", () => {
    const set: Array<[string, string]> = [];
    markSiteJustMade({ cookies: { set: (n, v) => { set.push([n, v]); } } }, "s1");
    expect(set).toEqual([["plexo-site", "s1"], [JUST_MADE_COOKIE, "s1"]]);
  });
});

describe("where the owner lands after creating the site", () => {
  it("always the dashboard home, where the new site's steps (Review and edit your pages, Finish up) are waiting", () => {
    expect(afterCreateHref()).toBe("/dashboard");
  });
  it("never the site's own hub page, whether or not SOL personalized it", () => {
    expect(afterCreateHref()).not.toContain("/sites/");
  });
});

describe("the note about what could not be carried over", () => {
  it("keeps only plain text, trimmed, without repeats, a handful at most", () => {
    expect(noticeMessages(["  A   piece of text  ", "A piece of text", 5, null, { x: 1 }, ""])).toEqual(["A piece of text"]);
    expect(noticeMessages(Array.from({ length: 9 }, (_, i) => `note ${i}`))).toHaveLength(5);
    expect(noticeMessages("nope")).toEqual([]);
    expect(noticeMessages(undefined)).toEqual([]);
  });
  it("has nothing to say when there is nothing to say", () => {
    expect(noticeFor("s1", [])).toBeNull();
    expect(noticeFor("", ["x"])).toBeNull();
    expect(noticeFor("s1", ["Check these"])).toEqual({ siteId: "s1", messages: ["Check these"] });
  });
  it("is read back only for the site it was written for", () => {
    const raw = JSON.stringify(noticeFor("s1", ["Check these"]));
    expect(readNotice(raw, "s1")).toEqual({ siteId: "s1", messages: ["Check these"] });
    expect(readNotice(raw, "s2")).toBeNull();
    expect(readNotice("not json", "s1")).toBeNull();
    expect(readNotice(null, "s1")).toBeNull();
  });
});

describe("create request carries the previewed design", () => {
  it("keeps brandedHtml and a valid brandColor, drops an oversized or malformed one", () => {
    const ok = parseCreateRequest({ goal: "business-site", name: "Aria", designId: "d", brandedHtml: "<html>x</html>", brandColor: "#2255EE" });
    expect(ok.ok && ok.value.brandedHtml).toBe("<html>x</html>");
    expect(ok.ok && ok.value.brandColor).toBe("#2255EE");
    const bad = parseCreateRequest({ goal: "business-site", name: "Aria", designId: "d", brandedHtml: "x".repeat(2_000_001), brandColor: "blue" });
    expect(bad.ok && bad.value.brandedHtml).toBeUndefined();
    expect(bad.ok && bad.value.brandColor).toBeUndefined();
  });
});
