import { describe, expect, it } from "vitest";
import { readTourState, resolveTourSteps, routeMatches, sanitizeTourState, siteTabsForKind, tourReducer } from "@/lib/dashboardV3/tour";
import { TOUR_AREAS, TOUR_STEPS } from "@/lib/dashboardV3/tourSteps";

describe("tour areas", () => {
  it("every step has a known area, ids are unique, and every area has steps", () => {
    const ids = new Set(TOUR_STEPS.map((s) => s.id));
    expect(ids.size).toBe(TOUR_STEPS.length);
    const known = new Set(TOUR_AREAS.map((a) => a.id));
    for (const s of TOUR_STEPS) expect(known.has(s.area ?? ""), s.id).toBe(true);
    for (const a of TOUR_AREAS) expect(resolveTourSteps(TOUR_STEPS, "detailed", { siteId: "s1", experience: "pro" }, a.id).length, a.id).toBeGreaterThan(0);
  });
  it("covers every site tab and every settings section", () => {
    const anchors = TOUR_STEPS.map((s) => s.anchor);
    for (const a of ["hub-pages", "hub-products", "hub-orders", "hub-blog", "hub-brand", "hub-address", "hub-visits", "hub-tab-health", "hub-settings", "hub-advanced", "settings-brand", "plan-current", "team-invite", "domains-list", "notif-list", "connect-cards", "move-give", "dev-keys", "hub-add-more", "site-switcher"]) {
      expect(anchors, a).toContain(a);
    }
  });
  it("replaying a part includes only its steps, short or detailed", () => {
    const steps = resolveTourSteps(TOUR_STEPS, "detailed", { siteId: "s1" }, "settings");
    expect(steps.length).toBeGreaterThan(8);
    expect(steps.every((s) => s.area === "settings")).toBe(true);
  });
  it("leaves out tabs the site doesn't have", () => {
    const blogSite = resolveTourSteps(TOUR_STEPS, "detailed", { siteId: "s1", siteKind: "Website" }).map((s) => s.id);
    expect(blogSite).not.toContain("site-products");
    expect(blogSite).toContain("site-pages");
    expect(resolveTourSteps(TOUR_STEPS, "detailed", { siteId: "s1", siteKind: "Online store" }).map((s) => s.id)).toContain("site-orders");
    expect(siteTabsForKind("Server app")).not.toContain("pages");
  });
  it("finishing a part ticks it off and keeps earlier ones; skipping keeps them", () => {
    const steps = resolveTourSteps(TOUR_STEPS, "detailed", { siteId: "s1" }, "sites");
    let s = tourReducer({ status: "unasked", doneAreas: ["home"] }, { type: "start", mode: "detailed", steps, area: "sites" });
    expect(s.area).toBe("sites");
    expect(s.doneAreas).toEqual(["home"]);
    s = tourReducer(s, { type: "later" });
    expect(s.area).toBe("sites");
    for (let i = 0; i < steps.length; i++) s = tourReducer(s, { type: "next", steps });
    expect(s.status).toBe("done");
    expect(s.doneAreas).toEqual(["home", "sites"]);
    expect(s.area).toBeUndefined();
    expect(tourReducer(s, { type: "skip" }).doneAreas).toEqual(["home", "sites"]);
  });
  it("stores and reads progress safely", () => {
    const state = sanitizeTourState({ status: "later", mode: "detailed", stepId: "site-pages", area: "site", doneAreas: ["home", "bad id!", 3, "home"] });
    expect(state?.doneAreas).toEqual(["home"]);
    expect(state?.area).toBe("site");
    expect(readTourState({ status: "done", area: "../x" }).area).toBeUndefined();
  });
  it("matches a step's tab, not just its page", () => {
    expect(routeMatches("/dashboard/sites/a?tab=products", "/dashboard/sites/a", "tab=products")).toBe(true);
    expect(routeMatches("/dashboard/sites/a?tab=products", "/dashboard/sites/a", "")).toBe(false);
    expect(routeMatches("/dashboard/sites/a?tab=pages", "/dashboard/sites/a", "")).toBe(true);
    expect(routeMatches("/dashboard/sites/a", "/dashboard/sites/a", "tab=brand")).toBe(true);
    expect(routeMatches("/dashboard/sites/a?tab=brand", "/dashboard/sites/b", "tab=brand")).toBe(false);
  });
});

describe("opening the site switcher from Home", () => {
  it("can start a part at a chosen step", () => {
    const steps = resolveTourSteps(TOUR_STEPS, "detailed", { siteId: "s1", experience: "beginner" }, "sites");
    expect(steps.map((s) => s.id)).toContain("sites-switch-panel");
    const s = tourReducer({ status: "unasked" }, { type: "start", mode: "detailed", steps, area: "sites", stepId: "sites-switch-panel" });
    expect(s.stepId).toBe("sites-switch-panel");
    expect(tourReducer({ status: "unasked" }, { type: "start", mode: "detailed", steps, area: "sites", stepId: "nope" }).stepId).toBe(steps[0].id);
  });
});
