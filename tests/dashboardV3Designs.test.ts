import { describe, expect, it } from "vitest";
import { afterUseHref, designKindLabel, designPrice, designsHref, feeSplit, listingStatus, payoutStatus } from "@/lib/dashboardV3/designs";

describe("designs in plain words", () => {
  it("names kinds and prices", () => {
    expect(designKindLabel("EMAIL")).toBe("Email");
    expect(designKindLabel("LANDING_PAGE")).toBe("Web page");
    expect(designPrice(0)).toBe("Free");
    expect(designPrice(1250)).toBe("$12.50");
  });
  it("explains every listing status and never shows the raw code", () => {
    for (const s of ["PUBLISHED", "PENDING_REVIEW", "REJECTED", "DRAFT", null, undefined]) {
      const r = listingStatus(s);
      expect(r.label).not.toMatch(/_/);
      expect(r.hint.length).toBeGreaterThan(5);
    }
    expect(listingStatus("PENDING_REVIEW").tone).toBe("warning");
    expect(listingStatus("REJECTED").tone).toBe("danger");
  });
  it("splits the fee", () => {
    expect(feeSplit(2000)).toEqual({ fee: "20", keep: "80" });
    expect(feeSplit(250)).toEqual({ fee: "2.50", keep: "97.50" });
  });
  it("builds list links leaving out defaults", () => {
    expect(designsHref({})).toBe("/dashboard/marketplace");
    expect(designsHref({ sort: "latest", page: 1, kind: "all", q: "" })).toBe("/dashboard/marketplace");
    expect(designsHref({ kind: "EMAIL", free: "true", sort: "popular", page: 3, q: "cafe" })).toBe("/dashboard/marketplace?kind=EMAIL&free=true&sort=popular&page=3&q=cafe");
  });
  it("takes a new web page to its site page and an email to its editor", () => {
    expect(afterUseHref("abc", "LANDING_PAGE")).toBe("/dashboard/sites/abc");
    expect(afterUseHref("abc", "EMAIL")).toBe("/dashboard/templates/abc");
  });
  it("words payouts", () => {
    expect(payoutStatus("PROCESSED").label).toBe("Paid");
    expect(payoutStatus("PENDING").label).toBe("On its way");
    expect(payoutStatus("REJECTED").tone).toBe("danger");
  });
});
