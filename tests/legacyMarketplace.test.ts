import { describe, expect, it } from "vitest";
import { legacyMarketplaceRedirect } from "@/lib/dashboardV3/legacyMarketplace";

describe("old public marketplace links", () => {
  it("send the list and a single design to the dashboard", () => {
    expect(legacyMarketplaceRedirect("/marketplace")).toBe("/dashboard/marketplace");
    expect(legacyMarketplaceRedirect("/marketplace/")).toBe("/dashboard/marketplace");
    expect(legacyMarketplaceRedirect("/marketplace/abc123")).toBe("/dashboard/marketplace/abc123");
  });
  it("leave every other path alone", () => {
    for (const p of ["/", "/marketplaces", "/marketplace/a/b", "/dashboard/marketplace", "/api/v1/marketplace/templates", "/about/marketplace"]) {
      expect(legacyMarketplaceRedirect(p)).toBeNull();
    }
  });
});
