import { describe, expect, it } from "vitest";
import { addMoreExample, pagesToday } from "@/lib/dashboardV3/addMoreExamples";

const pages = [{ name: "Home", path: "/" }, { name: "About", path: "/about" }, { name: "Contact", path: "/contact" }];

describe("add more examples", () => {
  it("lists the site's own pages", () => {
    expect(pagesToday(pages)).toBe("Home, About, Contact");
    expect(pagesToday([])).toBeNull();
    expect(pagesToday(Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, path: `/p${i}` })))).toBe("P0, P1, P2, P3, P4, P5 and 3 more");
  });
  it("says what a shop adds to the same site", () => {
    const e = addMoreExample("store", "Ama's Kitchen", pages);
    expect(e.today).toBe("Home, About, Contact");
    expect(e.adds[0]).toBe("/store");
    expect(e.summary).toContain("same website");
    expect(e.summary).toContain("/store");
  });
  it("keeps a page the owner already made at that address", () => {
    const e = addMoreExample("blog", "Site", [...pages, { name: "Blog", path: "/blog" }]);
    expect(e.adds).toEqual([]);
    expect(e.summary).toContain("Your own /blog page is kept");
  });
  it("adds no pages for a sign-up form", () => {
    expect(addMoreExample("newsletter", "Site", pages).adds).toEqual([]);
  });
});
