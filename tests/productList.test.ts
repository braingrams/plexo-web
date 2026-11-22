import { describe, expect, it } from "vitest";
import { MAX_RELATED, joinImages, makeCover, moveImage, pageSelection, paginate, plural, pruneSelection, removeImage, resolveProductsLayout, splitImages, stockInfo, toggleId, togglePage, toggleRelated } from "@/lib/dashboardV3/productList";

const nums = Array.from({ length: 25 }, (_, i) => i + 1);

describe("paginate", () => {
  it("slices a page and says what is showing", () => {
    const p = paginate(nums, 2, 10);
    expect(p.items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect([p.page, p.pages, p.total, p.from, p.to]).toEqual([2, 3, 25, 11, 20]);
  });
  it("pulls an out-of-range page back in and handles empty lists", () => {
    expect(paginate(nums, 99, 10).page).toBe(3);
    expect(paginate(nums, 99, 10).to).toBe(25);
    expect(paginate(nums, -4, 10).page).toBe(1);
    expect(paginate(nums, NaN, 10).page).toBe(1);
    const none = paginate([], 1, 10);
    expect([none.pages, none.from, none.to, none.items.length]).toEqual([1, 0, 0, 0]);
  });
});

describe("layout choice", () => {
  it("defaults to grid, keeps a saved choice, ignores junk", () => {
    expect(resolveProductsLayout(null)).toBe("grid");
    expect(resolveProductsLayout("list")).toBe("list");
    expect(resolveProductsLayout("table")).toBe("grid");
  });
});

describe("select several", () => {
  it("toggles one, selects all on a page without touching other pages", () => {
    let s = toggleId(new Set(), "a");
    expect([...s]).toEqual(["a"]);
    s = toggleId(s, "a");
    expect(s.size).toBe(0);
    const base = new Set(["z"]);
    const all = togglePage(base, ["a", "b"]);
    expect([...all].sort()).toEqual(["a", "b", "z"]);
    expect(pageSelection(all, ["a", "b"])).toBe("all");
    expect([...togglePage(all, ["a", "b"])]).toEqual(["z"]);
    expect(pageSelection(new Set(["a"]), ["a", "b"])).toBe("some");
    expect(pageSelection(new Set(), ["a"])).toBe("none");
  });
  it("drops ids that no longer exist", () => {
    expect([...pruneSelection(new Set(["a", "gone"]), ["a", "b"])]).toEqual(["a"]);
  });
  it("pluralises", () => {
    expect(plural(1, "product")).toBe("1 product");
    expect(plural(3, "product")).toBe("3 products");
  });
});

describe("stock badge", () => {
  it("only things you ship with zero left are out of stock", () => {
    expect(stockInfo({ kind: "PHYSICAL", stockQuantity: 0 })).toEqual({ soldOut: true, badge: "Out of stock", count: 0 });
    expect(stockInfo({ kind: "PHYSICAL", stockQuantity: 7 })).toEqual({ soldOut: false, badge: "In stock", count: 7 });
    expect(stockInfo({ kind: "PHYSICAL", stockQuantity: null }).count).toBeNull();
    expect(stockInfo({ kind: "DIGITAL", stockQuantity: 0 }).badge).toBe("In stock");
    expect(stockInfo({ kind: "PHYSICAL", stockQuantity: -2 }).count).toBe(0);
  });
});

describe("gallery order", () => {
  it("joins cover first, drops blanks and repeats, and splits back", () => {
    const list = joinImages("c", ["a", "c", "", "b"]);
    expect(list).toEqual(["c", "a", "b"]);
    expect(splitImages(list)).toEqual({ imageUrl: "c", galleryImageUrls: ["a", "b"] });
    expect(splitImages([])).toEqual({ imageUrl: "", galleryImageUrls: [] });
  });
  it("moves, sets the cover and removes", () => {
    expect(moveImage(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveImage(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(makeCover(["a", "b", "c"], 2)).toEqual(["c", "a", "b"]);
    expect(makeCover(["a", "b"], 0)).toEqual(["a", "b"]);
    expect(removeImage(["a", "b", "c"], 0)).toEqual(["b", "c"]);
  });
});

describe("sold together", () => {
  it("never goes past three", () => {
    let ids: string[] = [];
    for (const id of ["a", "b", "c", "d"]) ids = toggleRelated(ids, id);
    expect(ids).toHaveLength(MAX_RELATED);
    expect(toggleRelated(ids, "b")).toEqual(["a", "c"]);
  });
});
