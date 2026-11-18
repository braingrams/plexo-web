import { describe, expect, it } from "vitest";
import { filterListings, onboardingReturnPath, paginate, priceBadge, rankListings, topCategories, useLabel, type MarketListing } from "@/lib/onboarding/marketDesigns";

const L = (o: Partial<MarketListing> & { id: string }): MarketListing => ({ name: o.id, kind: "LANDING_PAGE", category: null, description: null, priceCents: 0, purchaseCount: 0, publishedAt: null, ...o });

describe("rankListings", () => {
  it("drops email designs and puts the best fit for the goal first", () => {
    const r = rankListings(
      [L({ id: "mail", kind: "EMAIL", category: "Shop" }), L({ id: "blog", category: "Blog" }), L({ id: "shop", category: "Online shop", name: "Boutique" }), L({ id: "other" })],
      "store",
    );
    expect(r[0].id).toBe("shop");
    expect(r[0].bestFit).toBe(true);
    expect(r.find((x) => x.id === "mail")).toBeUndefined();
    expect(r.find((x) => x.id === "other")?.bestFit).toBe(false);
  });
  it("breaks ties by most used, then newest", () => {
    const r = rankListings([L({ id: "a", purchaseCount: 1, publishedAt: "2026-01-01" }), L({ id: "b", purchaseCount: 5 }), L({ id: "c", purchaseCount: 1, publishedAt: "2026-06-01" })], "blog");
    expect(r.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
  it("uses what the owner does", () => {
    const r = rankListings([L({ id: "a", category: "Photography" }), L({ id: "b", category: "Restaurant" })], "explore", { about: "I run a small restaurant in Lagos" });
    expect(r[0].id).toBe("b");
  });
  it("maps every goal to some words", () => {
    for (const g of ["store", "business-site", "blog", "course", "landing", "link-in-bio", "explore", undefined]) expect(rankListings([L({ id: "x" })], g)).toHaveLength(1);
  });
});

describe("filters and labels", () => {
  const items = [L({ id: "f", name: "Fresh", category: "Food", priceCents: 0 }), L({ id: "p", name: "Pro", category: "Tech", priceCents: 1250, description: "for startups" })];
  it("filters by price, category and search", () => {
    expect(filterListings(items, { price: "free" }).map((x) => x.id)).toEqual(["f"]);
    expect(filterListings(items, { price: "paid" }).map((x) => x.id)).toEqual(["p"]);
    expect(filterListings(items, { category: "Tech" }).map((x) => x.id)).toEqual(["p"]);
    expect(filterListings(items, { q: " STARTUP " }).map((x) => x.id)).toEqual(["p"]);
    expect(filterListings(items, {})).toHaveLength(2);
  });
  it("lists common categories first", () => {
    expect(topCategories([L({ id: "1", category: "B" }), L({ id: "2", category: "A" }), L({ id: "3", category: "A" }), L({ id: "4" })])).toEqual(["A", "B"]);
  });
  it("labels free, paid and owned designs", () => {
    expect(priceBadge(0)).toEqual({ label: "Free", free: true });
    expect(priceBadge(1250).label).toBe("$12.50");
    expect(priceBadge(2000).label).toBe("$20");
    expect(priceBadge(2000, true).label).toBe("You own this");
    expect(useLabel(0, false)).toBe("Use this design");
    expect(useLabel(2000, true)).toBe("Use this design");
    expect(useLabel(2000, false)).toBe("Buy for $20 and use");
  });
  it("paginates safely", () => {
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual({ items: [3, 4], page: 2, pageCount: 3 });
    expect(paginate([1], 9, 2).page).toBe(1);
    expect(paginate([], 1, 2).pageCount).toBe(1);
  });
});

describe("onboardingReturnPath", () => {
  it("only returns to the setup page", () => {
    expect(onboardingReturnPath("/welcome/setup", "abc")).toBe("/welcome/setup?paidDesign=abc");
    expect(onboardingReturnPath("/welcome/setup?new=1", "abc")).toBe("/welcome/setup?new=1&paidDesign=abc");
    expect(onboardingReturnPath("https://evil.com", "abc")).toBeNull();
    expect(onboardingReturnPath("/welcome/setup/../../x", "abc")).toBeNull();
    expect(onboardingReturnPath(undefined, "abc")).toBeNull();
  });
});
