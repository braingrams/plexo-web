import { describe, expect, it } from "vitest";
import { LEGACY_SHOP_PAGES, SHOP_SECTIONS, legacyShopHref, shopNavGroups, currentShopNavKey, parseSettingsPart, resolveShopSection, shopHref, shopSections } from "@/lib/dashboardV3/shopSections";
import { hubTabs, NO_FEATURES, parseHubTab, resolveHubTab } from "@/lib/dashboardV3/hubTabs";
import { commerceNavItems } from "@/lib/dashboardV3/commerceNav";

describe("Shop tab", () => {
  it("only shops get it, right after Orders", () => {
    const ids = (f = NO_FEATURES) => hubTabs(f, "beginner").map((t) => t.id);
    expect(ids()).not.toContain("shop");
    expect(ids({ ...NO_FEATURES, store: true })).toEqual(["pages", "products", "orders", "shop", "brand", "address", "visits", "health", "settings"]);
    expect(resolveHubTab("shop", NO_FEATURES)).toBe("pages");
    expect(resolveHubTab("shop", { ...NO_FEATURES, store: true })).toBe("shop");
  });

  it("builds an address for each tool and every address opens the Shop tab", () => {
    for (const s of SHOP_SECTIONS) {
      const url = new URL(shopHref("s1", s.id), "https://x");
      expect(parseHubTab(url.searchParams.get("tab"))).toBe("shop");
      expect(url.searchParams.get("section")).toBe(s.id);
    }
    expect(shopHref("s1", "settings", "payments")).toBe("/dashboard/sites/s1?tab=shop&section=settings&part=payments");
    expect(shopHref("s1", "money", "payments")).not.toContain("part=");
  });

  it("every tool the old shop menu had now lives in the Shop tab (no one is sent back to the old pages)", () => {
    const old = commerceNavItems("s1")
      .map((i) => i.href.replace("/dashboard/commerce/s1/", ""))
      .filter((h) => !h.startsWith("/dashboard/sites"));
    const labels = commerceNavItems("s1").filter((i) => !i.href.startsWith("/dashboard/sites")).map((i) => i.label);
    for (const l of labels) expect(SHOP_SECTIONS.map((s) => s.label)).toContain(l);
    for (const page of old) {
      const key = page === "settings" ? "settings:general" : page;
      expect(legacyShopHref("s1", key), page).toMatch(/\?tab=shop&section=/);
    }
    for (const key of Object.keys(LEGACY_SHOP_PAGES)) expect(legacyShopHref("s1", key)).not.toBeNull();
    expect(legacyShopHref("s1", "nope")).toBeNull();
  });

  it("hides Booking times unless the shop sells a service, and falls back to Your money", () => {
    expect(shopSections({ sellsServices: false }).map((s) => s.id)).not.toContain("bookings");
    expect(shopSections({ sellsServices: true }).map((s) => s.id)).toContain("bookings");
    expect(resolveShopSection("bookings", shopSections({ sellsServices: false }))).toBe("money");
    expect(resolveShopSection(undefined, shopSections())).toBe("money");
    expect(parseSettingsPart("nonsense")).toBe("general");
    expect(parseSettingsPart("payments")).toBe("payments");
  });
});

describe("Shop tab menu", () => {
  it("is ONE grouped menu where the four settings parts are entries, not a second row", () => {
    const g = shopNavGroups(shopSections({ sellsServices: true }));
    expect(g.map((x) => x.label)).toEqual(["Money", "Selling", "Settings"]);
    expect(g[0].items.map((i) => i.label)).toEqual(["Your money", "Customers", "Discounts", "Delivery"]);
    expect(g[1].items.map((i) => i.label)).toEqual(["Booking times", "Donations"]);
    expect(g[2].items.map((i) => i.label)).toEqual(["General", "Payments", "Checkout", "Emails"]);
    expect(g[2].items.every((i) => i.section === "settings" && i.part)).toBe(true);
  });
  it("leaves Booking times out for shops without services, and marks the open entry", () => {
    const g = shopNavGroups(shopSections({ sellsServices: false }));
    expect(g[1].items.map((i) => i.key)).toEqual(["donations"]);
    expect(currentShopNavKey("settings", "payments")).toBe("settings:payments");
    expect(currentShopNavKey("money", "general")).toBe("money");
  });
});
