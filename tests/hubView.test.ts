import { describe, expect, it } from "vitest";
import { cleanPathPart, deletePageMessage, managePagesMode, movePage, orderedPages, pathProblem, resolveProductsView } from "@/lib/dashboardV3/hubView";

const page = (id: string, name: string, parentId: string | null, order: number, isRoot = false) => ({ id, name, parentId, order, isRoot, slug: name.toLowerCase() });
const PAGES = [page("h", "Home", null, 0, true), page("b", "Blog", "h", 1), page("a", "About", "h", 0), page("t", "Team", "a", 0)];

describe("products view", () => {
  it("opens simple for beginners and intermediates, full for pros", () => {
    expect(resolveProductsView("beginner", null)).toBe("simple");
    expect(resolveProductsView("intermediate", null)).toBe("simple");
    expect(resolveProductsView("pro", null)).toBe("full");
  });
  it("a remembered choice always wins", () => {
    expect(resolveProductsView("beginner", "full")).toBe("full");
    expect(resolveProductsView("pro", "simple")).toBe("simple");
    expect(resolveProductsView("pro", "junk")).toBe("full");
  });
});

describe("manage pages visibility", () => {
  it("is always visible for pros and on demand for everyone else", () => {
    expect(managePagesMode("pro")).toBe("always");
    expect(managePagesMode("beginner")).toBe("on-demand");
    expect(managePagesMode("intermediate")).toBe("on-demand");
  });
});

describe("page order", () => {
  it("lists home first, then each page followed by what is inside it", () => {
    expect(orderedPages(PAGES).map((p) => [p.name, p.depth])).toEqual([["Home", 0], ["About", 0], ["Team", 1], ["Blog", 0]]);
  });
  it("moves a page among its siblings only", () => {
    expect(movePage(PAGES, "b", -1)).toEqual([{ id: "b", order: 0 }, { id: "a", order: 1 }]);
    expect(movePage(PAGES, "a", -1)).toBeNull();
    expect(movePage(PAGES, "t", 1)).toBeNull();
    expect(movePage(PAGES, "h", 1)).toBeNull();
  });
});

describe("addresses and messages", () => {
  it("cleans an address", () => expect(cleanPathPart("  About Us! ")).toBe("about-us"));
  it("explains a clash or an empty address in plain words", () => {
    expect(pathProblem("!!!", [], null)).toMatch(/few letters/);
    expect(pathProblem("blog", [{ slug: "blog" }], "about")).toMatch(/already uses/);
    expect(pathProblem("blog", [{ slug: "blog" }], "blog")).toBeNull();
  });
  it("confirms deletes plainly", () => {
    expect(deletePageMessage("About", false, false)).toBe(`Delete "About"? Visitors will no longer see it. This can't be undone.`);
    expect(deletePageMessage("About", false, true)).toMatch(/pages inside it will go too/);
  });
});
