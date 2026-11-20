import { describe, expect, it } from "vitest";
import { buildV3Nav, activeNavId, SHOP_PRODUCTS_HREF } from "@/lib/dashboardV3/nav";
import { commerceEntryHref, shopQuickLinks } from "@/lib/dashboardV3/commerceNav";
import { parseHubTab } from "@/lib/dashboardV3/hubTabs";

describe("Add a product and Manage products are one tap away", () => {
  for (const experience of ["beginner", "intermediate", "pro"] as const) {
    it(`the menu has Orders and Products for a seller (${experience}) and nothing extra for others`, () => {
      const seller = buildV3Nav({ experience, sells: true });
      expect(seller.map((i) => i.id)).toEqual(expect.arrayContaining(["orders", "products"]));
      expect(seller.find((i) => i.id === "products")?.href).toBe(SHOP_PRODUCTS_HREF);
      expect(buildV3Nav({ experience }).map((i) => i.id)).not.toContain("products");
      expect(new Set(seller.map((i) => i.id)).size).toBe(seller.length);
    });
  }
  it("a store goal shows them even before a shop is on", () => {
    expect(buildV3Nav({ goal: "store" }).map((i) => i.id)).toContain("products");
  });
  it("the shop entry path highlights the shop in the menu", () => {
    expect(activeNavId(buildV3Nav({ sells: true }), "/dashboard/commerce")).toBe("orders");
    expect(activeNavId(buildV3Nav({ sells: true }), "/dashboard")).toBe("home");
  });
  it("the shop entry sends products to the Products tab and everything else to Orders", () => {
    expect(commerceEntryHref("s1", "products")).toBe("/dashboard/sites/s1?tab=products");
    expect(commerceEntryHref("s1")).toBe("/dashboard/sites/s1?tab=orders");
    expect(commerceEntryHref("s1", "junk")).toBe("/dashboard/sites/s1?tab=orders");
  });
  it("Home shortcuts open real hub tabs, and Add a product opens the form", () => {
    const links = shopQuickLinks("s1");
    expect(links.map((l) => l.id)).toEqual(["add", "manage", "orders"]);
    for (const l of links) expect(parseHubTab(new URL(l.href, "https://x").searchParams.get("tab"))).not.toBeNull();
    expect(links[0].href).toBe("/dashboard/sites/s1?tab=products&new=product");
  });
});
