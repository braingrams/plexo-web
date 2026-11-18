import { describe, expect, it } from "vitest";
import { getTierFeatures } from "@/lib/subscription";

describe("multi-page sites and site moves", () => {
  it("Free is a single page; every paid plan can have several pages", () => {
    expect(getTierFeatures("FREE")).toMatchObject({ multiPageSitesEnabled: false, siteMigrationEnabled: true });
    for (const plan of ["STARTER", "PRO", "ENTERPRISE", "ULTRA"]) {
      expect(getTierFeatures(plan)).toMatchObject({ multiPageSitesEnabled: true, siteMigrationEnabled: true });
    }
  });
  it("an unknown plan is treated as Free", () => {
    expect(getTierFeatures("MYSTERY").multiPageSitesEnabled).toBe(false);
  });
});
