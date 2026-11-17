import { describe, expect, it } from "vitest";
import { isInternalNavigation, nextProgress, routeKey } from "../lib/dashboardV3/navProgress";

const here = { origin: "https://app.plexo.test", pathname: "/dashboard/sites/s1", search: "?tab=pages" };
const go = (href: string | null, extra: object = {}) => isInternalNavigation({ href, button: 0, ...extra }, here);

describe("which clicks start the progress bar", () => {
  it("counts a move to another dashboard page, tab or section", () => {
    expect(go("/dashboard/settings/plan")).toBe(true);
    expect(go("/dashboard/sites/s1?tab=settings")).toBe(true);
    expect(go("https://app.plexo.test/dashboard/sites")).toBe(true);
    expect(go("?tab=advanced&section=seo")).toBe(true);
  });
  it("ignores links that stay put or leave", () => {
    expect(go("/dashboard/sites/s1?tab=pages")).toBe(false);
    expect(go("#set-danger")).toBe(false);
    expect(go("https://example.com/dashboard")).toBe(false);
    expect(go("mailto:a@b.co")).toBe(false);
    expect(go("/pricing")).toBe(false);
    expect(go(null)).toBe(false);
    expect(go("/dashboard/sites", { target: "_blank" })).toBe(false);
    expect(go("/dashboard/sites", { download: true })).toBe(false);
    expect(go("/dashboard/sites", { metaKey: true })).toBe(false);
    expect(go("/dashboard/sites", { button: 1 })).toBe(false);
  });
  it("a link that only changes the search of this page counts", () => {
    expect(go("/dashboard/sites/s1?tab=brand")).toBe(true);
  });
});

describe("progress", () => {
  it("eases up but never reaches 90 on its own", () => {
    let p = 8;
    for (let i = 0; i < 500; i++) p = nextProgress(p);
    expect(p).toBeLessThanOrEqual(90);
    expect(nextProgress(10)).toBeGreaterThan(10);
  });
  it("route key changes with the tab", () => {
    expect(routeKey("/a", "tab=1")).not.toBe(routeKey("/a", "tab=2"));
  });
});
