import { describe, expect, it } from "vitest";
import { hubRedirectTarget, hubTabForOldDetail, siteHubHref } from "@/lib/dashboardV3/hubPaths";

describe("hub paths", () => {
  it("links to the hub, with a tab only when it is not Pages", () => {
    expect(siteHubHref("s1")).toBe("/dashboard/sites/s1");
    expect(siteHubHref("s1", "pages")).toBe("/dashboard/sites/s1");
    expect(siteHubHref("s1", "settings")).toBe("/dashboard/sites/s1?tab=settings");
  });
  it("maps the old detail tabs", () => {
    expect(hubTabForOldDetail("preview", false)).toBe("pages");
    expect(hubTabForOldDetail("properties", false)).toBe("settings");
    expect(hubTabForOldDetail("domain", false)).toBe("address");
    expect(hubTabForOldDetail("modules", true)).toBe("settings");
    expect(hubTabForOldDetail("server", true)).toBe("app");
    expect(hubTabForOldDetail("variables", false)).toBe("settings");
    expect(hubTabForOldDetail(undefined, true)).toBe("app");
  });
  it("falls back to Pages (or App for a hosted app) for unknown or missing old tabs", () => {
    expect(hubTabForOldDetail("nonsense", false)).toBe("pages");
    expect(hubTabForOldDetail(null, false)).toBe("pages");
    expect(hubTabForOldDetail("nonsense", true)).toBe("app");
    expect(hubTabForOldDetail("traffic", true)).toBe("visits");
  });
});

describe("old page -> hub redirect decision", () => {
  const base = { siteId: "s1", tab: "address" };
  it("sends new-dashboard users to the matching hub tab", () => {
    expect(hubRedirectTarget({ ...base, newDashboard: true })).toBe("/dashboard/sites/s1?tab=address");
    expect(hubRedirectTarget({ ...base, newDashboard: true, tab: "pages" })).toBe("/dashboard/sites/s1");
  });
  it("never moves old-dashboard users", () => {
    expect(hubRedirectTarget({ ...base, newDashboard: false })).toBeNull();
  });
  it("lets ?classic=1 keep the old page, and ignores other values", () => {
    expect(hubRedirectTarget({ ...base, newDashboard: true, classic: "1" })).toBeNull();
    expect(hubRedirectTarget({ ...base, newDashboard: true, classic: ["1"] })).toBeNull();
    expect(hubRedirectTarget({ ...base, newDashboard: true, classic: "0" })).toBe("/dashboard/sites/s1?tab=address");
    expect(hubRedirectTarget({ ...base, newDashboard: true, classic: undefined })).toBe("/dashboard/sites/s1?tab=address");
  });
});
