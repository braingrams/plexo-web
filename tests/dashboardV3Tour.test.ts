import { describe, expect, it } from "vitest";
import { absentKey, anchorOnThisPage, currentTourPosition, readTourState, resolveTourSteps, routeKey, sameRoute, sanitizeTourState, shellStepBlocked, shouldOfferTour, stepAfterRemoved, stepAnchors, tourReducer, type TourStep } from "@/lib/dashboardV3/tour";
import { TOUR_STEPS } from "@/lib/dashboardV3/tourSteps";

const REG: TourStep[] = [
  { id: "c", anchor: "c", route: "/dashboard/profile", title: "C", body: "", tours: ["detailed"], order: 30 },
  { id: "a", anchor: "a", route: "/dashboard", title: "A", body: "", tours: ["short", "detailed"], order: 10 },
  { id: "b", anchor: "b", route: (ctx) => (ctx.siteId ? `/dashboard/sites/${ctx.siteId}` : null), title: "B", body: "", tours: ["detailed"], order: 20 },
  { id: "p", anchor: "p", route: "*", title: "P", body: "", tours: ["short", "detailed"], order: 40, experiences: ["pro"] },
];

describe("tour steps", () => {
  it("orders steps, filters by tour and experience, resolves routes", () => {
    expect(resolveTourSteps(REG, "short").map((s) => s.id)).toEqual(["a", "p"]);
    expect(resolveTourSteps(REG, "short", { experience: "beginner" }).map((s) => s.id)).toEqual(["a"]);
    const detailed = resolveTourSteps(REG, "detailed", { siteId: "s1", experience: "pro" });
    expect(detailed.map((s) => s.id)).toEqual(["a", "b", "c", "p"]);
    expect(detailed[1].route).toBe("/dashboard/sites/s1");
    expect(resolveTourSteps(REG, "detailed", {}).map((s) => s.id)).toEqual(["a", "c", "p"]);
  });

  it("the real registry has unique ids/orders and plain-word copy", () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(resolveTourSteps(TOUR_STEPS, "short").length).toBeGreaterThan(2);
    expect(resolveTourSteps(TOUR_STEPS, "detailed", { siteId: "x" }).length).toBeGreaterThan(resolveTourSteps(TOUR_STEPS, "short").length);
    for (const s of TOUR_STEPS) expect(`${s.title} ${s.body}`).not.toMatch(/(template|deploy|DNS|SDK|slug|subdomain|AI assistant|assistant|agent|bot|AI credits)/i);
  });

  it("matches routes loosely", () => {
    expect(sameRoute("/dashboard/", "/dashboard?x=1")).toBe(true);
    expect(sameRoute("*", "/anything")).toBe(true);
    expect(sameRoute("/dashboard", "/dashboard/sites")).toBe(false);
  });
});

describe("tour state", () => {
  const steps = resolveTourSteps(REG, "detailed", { siteId: "s1", experience: "pro" });
  const now = "2026-11-16T00:00:00.000Z";

  it("asks only first-timers", () => {
    expect(shouldOfferTour(undefined)).toBe(true);
    expect(shouldOfferTour({ status: "unasked" })).toBe(true);
    expect(shouldOfferTour({ status: "later" })).toBe(false);
    expect(shouldOfferTour({ status: "done" })).toBe(false);
  });

  it("walks forward and back, finishing after the last step", () => {
    let s = tourReducer({ status: "unasked" }, { type: "start", mode: "detailed", steps }, now);
    expect(s).toEqual({ status: "active", mode: "detailed", stepId: "a", updatedAt: now });
    s = tourReducer(s, { type: "back", steps }, now);
    expect(s.stepId).toBe("a");
    s = tourReducer(s, { type: "next", steps }, now);
    s = tourReducer(s, { type: "next", steps }, now);
    expect(currentTourPosition(s, steps)).toMatchObject({ index: 2, total: 4 });
    s = tourReducer(s, { type: "back", steps }, now);
    expect(s.stepId).toBe("b");
    s = tourReducer(s, { type: "next", steps }, now);
    s = tourReducer(s, { type: "next", steps }, now);
    s = tourReducer(s, { type: "next", steps }, now);
    expect(s.status).toBe("done");
    expect(currentTourPosition(s, steps)).toBeNull();
  });

  it("pauses (resumable), skips, and survives a step that was removed", () => {
    const active = { status: "active" as const, mode: "detailed" as const, stepId: "b" };
    const paused = tourReducer(active, { type: "later" }, now);
    expect(paused).toMatchObject({ status: "later", stepId: "b", mode: "detailed" });
    expect(tourReducer(paused, { type: "goto", stepId: "b" }, now).status).toBe("active");
    expect(tourReducer(active, { type: "skip" }, now).status).toBe("skipped");
    expect(currentTourPosition({ status: "active", mode: "detailed", stepId: "removed" }, steps)?.step.id).toBe("a");
    expect(tourReducer({ status: "unasked" }, { type: "start", mode: "short", steps: [] }, now).status).toBe("done");
  });

  it("validates what the profile API stores", () => {
    expect(sanitizeTourState({ status: "active", mode: "short", stepId: "home-intro", extra: 1 })).toMatchObject({ status: "active", mode: "short", stepId: "home-intro" });
    expect(sanitizeTourState({ status: "hacked" })).toBeNull();
    expect(sanitizeTourState({ status: "active", stepId: "<script>" })).toEqual({ status: "active", updatedAt: expect.any(String) });
    expect(readTourState(undefined)).toEqual({ status: "unasked" });
    expect(readTourState({ status: "done", updatedAt: "x" })).toEqual({ status: "done", updatedAt: "x" });
  });
});

describe("Home views and the SOL introduction", () => {
  const short = (homeView?: "guided" | "live" | "quiet" | "all" | "none") => resolveTourSteps(TOUR_STEPS, "short", { siteId: "s1", experience: "beginner", homeView }).map((s) => s.id);

  it("while setup is in progress the short tour goes 3 -> 4 with no step that Home does not show", () => {
    expect(short("guided")).toEqual(["home-intro", "ask-sol", "home-next-step", "home-your-site", "site-switcher", "main-menu", "help-menu"]);
    expect(short("guided")).not.toContain("home-numbers");
  });

  it("a live site gets the numbers step, but not the next-step card that only setup shows", () => {
    expect(short("live")).toContain("home-numbers");
    expect(short("live")).not.toContain("home-next-step");
    expect(short("quiet")).not.toContain("home-numbers");
  });

  it("the every-site and no-site views skip steps about cards they do not render", () => {
    expect(short("all")).toEqual(["ask-sol", "site-switcher", "main-menu", "help-menu"]);
    expect(short("none")).toEqual(["ask-sol", "site-switcher", "main-menu", "help-menu"]);
    expect(resolveTourSteps(TOUR_STEPS, "detailed", { siteId: "s1", homeView: "all" }).map((s) => s.id)).toContain("home-all-sites");
    expect(resolveTourSteps(TOUR_STEPS, "detailed", { siteId: "s1", homeView: "guided" }).map((s) => s.id)).not.toContain("home-all-sites");
  });

  it("before Home has reported its view nothing is filtered by it", () => {
    expect(short(undefined)).toContain("home-numbers");
  });

  it("numbering follows the filtered list, so N of M stays accurate", () => {
    const steps = resolveTourSteps(TOUR_STEPS, "short", { siteId: "s1", experience: "beginner", homeView: "guided" });
    let s = tourReducer({ status: "unasked" }, { type: "start", mode: "short", steps }, "t");
    const seen: string[] = [];
    for (;;) {
      const pos = currentTourPosition(s, steps)!;
      seen.push(`${pos.index + 1}/${pos.total}:${pos.step.id}`);
      if (pos.index === pos.total - 1) break;
      s = tourReducer(s, { type: "next", steps }, "t");
    }
    expect(seen[3]).toBe("4/7:home-your-site");
    expect(seen[4]).toBe("5/7:site-switcher");
  });

  it("introduces SOL in first person, early, with the mascot, anchored on its entry point", () => {
    const sol = TOUR_STEPS.find((s) => s.id === "ask-sol")!;
    expect(sol.anchor).toBe("ask-sol");
    expect(sol.mascot).toBe("sol");
    expect(sol.body).toContain("I can build and change your website for you");
    expect(sol.title).toBe("Hi, I'm SOL");
    expect(sol.body).toMatch(/just tell me what you want/);
    expect(short("guided").indexOf("ask-sol")).toBeLessThanOrEqual(1);
    expect(sol.tours).toEqual(["short", "detailed"]);
  });
});

describe("no step ever waits for an anchor that cannot appear", () => {
  const ids = (ctx: Parameters<typeof resolveTourSteps>[2], mode: "short" | "detailed" = "detailed", area?: string) => resolveTourSteps(TOUR_STEPS, mode, ctx, area).map((s) => s.id);
  const base = { siteId: "s1", experience: "beginner" as const };

  it("every Home-only step is offered in exactly the Home views that render its anchor (route/view matrix)", () => {
    // What each Home view renders, from HomeView.tsx: the anchors only that view has.
    const rendered: Record<string, string[]> = {
      guided: ["home-main", "home-current-task", "home-site-card"],
      finishing: ["home-main", "home-site-card"],
      live: ["home-main", "home-stats", "home-site-card"],
      quiet: ["home-main", "home-site-card"],
      all: ["home-sites"],
      none: [],
    };
    const homeOnly = TOUR_STEPS.filter((s) => s.homeViews);
    expect(homeOnly.length).toBeGreaterThan(4);
    for (const [view, anchors] of Object.entries(rendered)) {
      const offered = resolveTourSteps(TOUR_STEPS, "detailed", { ...base, homeView: view as never });
      for (const step of homeOnly) {
        const has = offered.some((o) => o.id === step.id);
        expect(has, `${step.id} in ${view}`).toBe(anchors.includes(step.anchor));
      }
    }
    // Every step that points at a Home page anchor must declare its views (none can sneak through unfiltered).
    for (const s of TOUR_STEPS.filter((x) => x.route === "/dashboard")) expect(s.homeViews, s.id).toBeDefined();
  });

  it("the setup-done 'You're live' moment has no next-step card to point at", () => {
    expect(ids({ ...base, homeView: "finishing" }, "short")).not.toContain("home-next-step");
    expect(ids({ ...base, homeView: "finishing" }, "short")).toContain("home-intro");
  });

  it("hides what a screen size cannot show", () => {
    expect(ids({ ...base, viewport: "desktop" })).toContain("appearance");
    expect(ids({ ...base, viewport: "tablet" })).not.toContain("appearance");
    expect(ids({ ...base, viewport: "phone" })).not.toContain("appearance");
    expect(ids({ ...base, viewport: "phone" })).not.toContain("sites-switch-panel");
    expect(ids({ ...base, viewport: "tablet" })).toContain("sites-switch-panel");
  });

  it("a folded desktop menu has no site switcher, so its steps are left out up front", () => {
    const chrome = { frame: "full" as const, sidebarMenu: true, folded: true, tabbarSol: true };
    expect(ids({ ...base, viewport: "desktop", chrome }, "short")).not.toContain("site-switcher");
    expect(ids({ ...base, viewport: "phone", chrome }, "short")).toContain("site-switcher"); // phones use the top bar copy
    expect(ids({ ...base, viewport: "desktop", chrome: { ...chrome, folded: false } }, "short")).toContain("site-switcher");
  });

  it("leaves out steps a page has said it does not show this person, and keeps counting right", () => {
    const team = "/dashboard/settings/team";
    const all = ids({ ...base, absent: [] }, "detailed", "settings");
    expect(all).toContain("team-invite");
    const without = ids({ ...base, absent: [absentKey(team, "team-invite")] }, "detailed", "settings");
    expect(without).not.toContain("team-invite");
    expect(without.length).toBe(all.length - 1);
    // Scoped to that page: the same anchor name elsewhere is unaffected, and a site tab is part of the scope.
    expect(ids({ ...base, absent: [absentKey("/dashboard/sites/s1?tab=more", "hub-add-more")] })).not.toContain("site-settings-more");
    expect(ids({ ...base, absent: [absentKey("/dashboard/sites/s1?tab=more", "hub-add-more")] })).toContain("site-add-more");
    expect(ids({ ...base, absent: [absentKey("/dashboard/sites/s1", "hub-add-more")] })).not.toContain("site-add-more");
  });

  it("route keys ignore a trailing slash and the default Pages tab, and keep other tabs", () => {
    expect(routeKey("/dashboard/sites/a/")).toBe("/dashboard/sites/a");
    expect(routeKey("/dashboard/sites/a", "tab=pages")).toBe("/dashboard/sites/a");
    expect(routeKey("/dashboard/sites/a", "tab=more&x=1")).toBe("/dashboard/sites/a?tab=more");
    expect(routeKey("/dashboard/sites/a?tab=more")).toBe("/dashboard/sites/a?tab=more");
  });

  it("steps about tabs an uploaded or server app does not have are left out (no Pages / Brand anchors there)", () => {
    const app = ids({ ...base, siteKind: "Server app" });
    for (const gone of ["site-pages", "site-add-page", "site-add-more", "site-brand", "site-products", "site-blog"]) expect(app, gone).not.toContain(gone);
    expect(app).toContain("site-settings-more");
    expect(app).toContain("site-address");
  });

  it("each site step's route is the tab its anchor lives on", () => {
    const route = (id: string) => resolveTourSteps(TOUR_STEPS, "detailed", { siteId: "s1" }).find((s) => s.id === id)!.route;
    expect(route("site-settings-more")).toBe("/dashboard/sites/s1?tab=more"); // the Settings tab has no Add-more section
    expect(route("site-add-more")).toBe("/dashboard/sites/s1?tab=pages");
  });
});

describe("shell-wide steps and the page the person is on", () => {
  const short = resolveTourSteps(TOUR_STEPS, "short", { siteId: "s1" });
  const ask = short.find((s) => s.id === "ask-sol")!;
  const menu = short.find((s) => s.id === "main-menu")!;
  const help = short.find((s) => s.id === "help-menu")!;
  const full = { frame: "full" as const, sidebarMenu: true, folded: false, tabbarSol: true };

  it("is never blocked on an ordinary page, at any size", () => {
    for (const viewport of ["phone", "tablet", "desktop"] as const) {
      expect(shellStepBlocked(ask, { viewport, chrome: full })).toBe(false);
      expect(shellStepBlocked(menu, { viewport, chrome: full })).toBe(false);
    }
  });

  it("before the shell has reported, nothing is treated as missing", () => {
    expect(shellStepBlocked(menu, {})).toBe(false);
  });

  it("the page editor and hosted-app screens lack the top bar, so shell steps are blocked there (and the tour moves to Home)", () => {
    const editor = { frame: "editor" as const, sidebarMenu: true, folded: true, tabbarSol: false };
    expect(shellStepBlocked(menu, { viewport: "phone", chrome: editor })).toBe(true); // no bottom bar in the editor
    expect(shellStepBlocked(menu, { viewport: "desktop", chrome: editor })).toBe(false); // the folded menu is still there
    expect(shellStepBlocked(help, { viewport: "desktop", chrome: editor })).toBe(true);
    expect(shellStepBlocked(menu, { viewport: "desktop", chrome: { frame: "none", sidebarMenu: false, folded: false, tabbarSol: false } })).toBe(true);
  });

  it("SOL's conversation list replaces the menu on desktop, so the menu step moves to Home", () => {
    expect(shellStepBlocked(menu, { viewport: "desktop", chrome: { ...full, sidebarMenu: false } })).toBe(true);
    expect(shellStepBlocked(menu, { viewport: "phone", chrome: { ...full, sidebarMenu: false } })).toBe(false);
  });

  it("the SOL step is still on screen in the editor through the folded menu's Ask SOL item", () => {
    const editor = { frame: "editor" as const, sidebarMenu: true, folded: true, tabbarSol: false };
    expect(shellStepBlocked(ask, { viewport: "desktop", chrome: editor })).toBe(false);
    expect(anchorOnThisPage("ask-sol", { viewport: "desktop", chrome: editor })).toBe(false);
    expect(anchorOnThisPage("ask-sol-menu", { viewport: "desktop", chrome: editor })).toBe(true);
  });

  it("on a phone the Ask SOL menu item only counts when it is one of the bottom bar's buttons", () => {
    expect(anchorOnThisPage("ask-sol-menu", { viewport: "phone", chrome: { ...full, tabbarSol: false } })).toBe(false);
    expect(anchorOnThisPage("ask-sol-menu", { viewport: "phone", chrome: full })).toBe(true);
    // The top bar icon is always there, so the step is never blocked on a phone.
    expect(shellStepBlocked(ask, { viewport: "phone", chrome: { ...full, tabbarSol: false } })).toBe(false);
  });
});

describe("the SOL step points at both places", () => {
  const sol = TOUR_STEPS.find((s) => s.id === "ask-sol")!;

  it("names the top bar box and the Ask SOL menu item", () => {
    expect(stepAnchors(sol)).toEqual(["ask-sol", "ask-sol-menu"]);
    expect(stepAnchors({ anchor: "x" })).toEqual(["x"]);
  });

  it("resolved steps keep the anchors in order, with the first as the primary", () => {
    const r = resolveTourSteps(TOUR_STEPS, "short", { siteId: "s1" }).find((s) => s.id === "ask-sol")!;
    expect(r.anchor).toBe("ask-sol");
    expect(r.anchors).toEqual(["ask-sol", "ask-sol-menu"]);
  });

  it("keeps first-person copy, naming SOL, with no 'assistant' wording", () => {
    expect(sol.body.startsWith("I can build and change your website for you — just tell me what you want.")).toBe(true);
    expect(`${sol.title} ${sol.body}`).not.toMatch(/assistant|agent|\bbot\b|Plexo's AI/i);
  });

  it("every anchor name in the registry is a plain data-tour id", () => {
    for (const s of TOUR_STEPS) expect(stepAnchors(s).every((a) => /^[a-z0-9-]+$/.test(a)), s.id).toBe(true);
  });
});

describe("a list that changes under a running tour", () => {
  it("carries on from the next step in order, not from the start", () => {
    const without = resolveTourSteps(TOUR_STEPS, "short", { siteId: "s1", experience: "beginner", homeView: "all" });
    // They were on "home-intro"; the view turned out to be "all", which has no such step.
    expect(without.some((s) => s.id === "home-intro")).toBe(false);
    expect(stepAfterRemoved(TOUR_STEPS, "home-intro", without)?.id).toBe("ask-sol");
  });

  it("is null when the removed step was the last one, and restarts only for an id that no longer exists", () => {
    const steps = resolveTourSteps(TOUR_STEPS, "short", { siteId: "s1", experience: "beginner", homeView: "live" }).filter((s) => s.id !== "help-menu");
    expect(stepAfterRemoved(TOUR_STEPS, "help-menu", steps)).toBeNull();
    expect(stepAfterRemoved(TOUR_STEPS, "deleted-long-ago", steps)?.id).toBe(steps[0].id);
  });
});
