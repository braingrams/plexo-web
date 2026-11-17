import { describe, expect, it } from "vitest";
import { filterSites, isAppKind, oldListRedirect, parseSiteFilter, sitesListHref } from "@/lib/dashboardV3/siteFilter";

describe("sites list filter", () => {
  it("reads ?show= and falls back to everything", () => {
    expect(parseSiteFilter("apps")).toBe("apps");
    expect(parseSiteFilter(["websites", "apps"])).toBe("websites");
    expect(parseSiteFilter("nonsense")).toBe("all");
    expect(parseSiteFilter(undefined)).toBe("all");
  });
  it("tells apps from websites by their label", () => {
    expect(isAppKind("App with sign-in")).toBe(true);
    expect(isAppKind("Server app")).toBe(true);
    expect(isAppKind("Online store")).toBe(false);
  });
  it("filters", () => {
    const list = [{ id: "a", app: true }, { id: "b", app: false }];
    expect(filterSites(list, "apps").map((s) => s.id)).toEqual(["a"]);
    expect(filterSites(list, "websites").map((s) => s.id)).toEqual(["b"]);
    expect(filterSites(list, "all")).toHaveLength(2);
  });
  it("builds addresses", () => {
    expect(sitesListHref("all")).toBe("/dashboard/sites");
    expect(sitesListHref("apps")).toBe("/dashboard/sites?show=apps");
  });
});

describe("old list page redirect", () => {
  it("sends new-dashboard users to the filtered Sites list", () => {
    expect(oldListRedirect({ newDashboard: true, filter: "websites" })).toBe("/dashboard/sites?show=websites");
  });
  it("leaves old-dashboard users and ?classic=1 alone", () => {
    expect(oldListRedirect({ newDashboard: false, filter: "apps" })).toBeNull();
    expect(oldListRedirect({ newDashboard: true, classic: "1", filter: "apps" })).toBeNull();
    expect(oldListRedirect({ newDashboard: true, classic: ["1"], filter: "apps" })).toBeNull();
  });
});
