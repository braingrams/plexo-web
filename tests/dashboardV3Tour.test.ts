import { describe, expect, it } from "vitest";
import { currentTourPosition, readTourState, resolveTourSteps, sameRoute, sanitizeTourState, shouldOfferTour, tourReducer, type TourStep } from "@/lib/dashboardV3/tour";
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
    for (const s of TOUR_STEPS) expect(`${s.title} ${s.body}`).not.toMatch(/\b(template|deploy|DNS|SDK|slug|subdomain)\b/i);
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
