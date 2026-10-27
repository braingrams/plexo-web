import { describe, expect, it } from "vitest";
import { getTierFeatures } from "@/lib/subscription";

describe("multi-page sites and site moves", () => {
  it("Free is a single page; Pro and Ultra can have several pages and move a whole site in", () => {
    expect(getTierFeatures("FREE")).toMatchObject({ multiPageSitesEnabled: false, siteMigrationEnabled: false });
    for (const plan of ["PRO", "ULTRA"]) {
      expect(getTierFeatures(plan)).toMatchObject({ multiPageSitesEnabled: true, siteMigrationEnabled: true });
    }
  });
  it("an unknown plan is treated as Free", () => {
    expect(getTierFeatures("MYSTERY").multiPageSitesEnabled).toBe(false);
  });
});
