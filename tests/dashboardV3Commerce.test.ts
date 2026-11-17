import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commerceEntryHref, commerceNavItems, currentCommerceHref, pickShopSiteId } from "@/lib/dashboardV3/commerceNav";
import { filterProducts } from "@/lib/dashboardV3/productFilter";
import { orderNumberMatches } from "@/app/dashboard/_v3/hub/OrderTools";

describe("shop navigation on the new dashboard", () => {
  const items = commerceNavItems("s1");
  it("sends Products and Orders to the site hub and keeps the rest as shop pages", () => {
    expect(items[0]).toEqual({ href: "/dashboard/sites/s1?tab=products", label: "Products" });
    expect(items[1].href).toBe("/dashboard/sites/s1?tab=orders");
    expect(items.map((i) => i.label)).toContain("Shop settings");
    expect(items.find((i) => i.label === "Your money")?.href).toBe("/dashboard/commerce/s1/wallet");
  });
  it("can hide booking times", () => {
    expect(commerceNavItems("s1", { sellsServices: false }).map((i) => i.label)).not.toContain("Booking times");
  });
  it("marks the tab a sub-page belongs to", () => {
    expect(currentCommerceHref(items, "/dashboard/commerce/s1/settings/payments")).toBe("/dashboard/commerce/s1/settings");
    expect(currentCommerceHref(items, "/dashboard/commerce/s1/discounts")).toBe("/dashboard/commerce/s1/discounts");
    expect(currentCommerceHref(items, "/dashboard/commerce/s1/unknown")).toBe("");
  });
  it("opens the shop that is on, else the newest site", () => {
    expect(pickShopSiteId([{ id: "a", enabled: false }, { id: "b", enabled: true }])).toBe("b");
    expect(pickShopSiteId([{ id: "a", enabled: false }, { id: "b", enabled: false }])).toBe("a");
    expect(pickShopSiteId([])).toBeNull();
    expect(commerceEntryHref("b")).toBe("/dashboard/sites/b?tab=orders");
  });
});

describe("product search", () => {
  const ps = [
    { name: "Jollof spice", kind: "PHYSICAL", stockQuantity: 0, category: "Food" },
    { name: "Recipe book", kind: "DIGITAL", stockQuantity: null, category: null },
    { name: "Chilli oil", kind: "PHYSICAL", stockQuantity: 5, category: "Food" },
  ];
  it("matches every word in the name or category", () => {
    expect(filterProducts(ps, "food oil", "all").map((p) => p.name)).toEqual(["Chilli oil"]);
    expect(filterProducts(ps, "", "all")).toHaveLength(3);
  });
  it("only physical products with none left are sold out", () => {
    expect(filterProducts(ps, "", "out").map((p) => p.name)).toEqual(["Jollof spice"]);
    expect(filterProducts(ps, "", "in").map((p) => p.name)).toEqual(["Recipe book", "Chilli oil"]);
  });
});

describe("order number confirmation", () => {
  it("ignores case and spaces", () => {
    expect(orderNumberMatches(" ab-12 ", "AB-12")).toBe(true);
    expect(orderNumberMatches("1043", 1043)).toBe(true);
    expect(orderNumberMatches("1044", 1043)).toBe(false);
  });
});

describe("shop colours come from the new dashboard's tokens", () => {
  const ROOT = join(__dirname, "..");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : []; });
  const css = readFileSync(join(ROOT, "app/dashboard/commerce/_components/cmx.css"), "utf8");
  const defined = new Set([...css.matchAll(/(--cmx-[a-z-]+):/g)].map((m) => m[1]));
  it("every --cmx-* colour a shop page asks for is defined, and maps to a live token", () => {
    const used = new Set<string>();
    for (const f of [...files(join(ROOT, "app/dashboard/commerce")), ...files(join(ROOT, "app/dashboard/insights")), join(ROOT, "app/dashboard/_components/Card.tsx"), join(ROOT, "app/dashboard/_components/PageHeader.tsx"), join(ROOT, "app/dashboard/_components/TrafficChart.tsx")]) {
      for (const m of readFileSync(f, "utf8").matchAll(/var\((--cmx-[a-z-]+)/g)) used.add(m[1]);
    }
    expect([...used].filter((u) => !defined.has(u))).toEqual([]);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/);
  });
});
