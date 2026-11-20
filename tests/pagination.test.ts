import { describe, expect, it } from "vitest";
import { PAGE_SIZE_OPTIONS, pageWindow, paginate, parsePageRequest } from "@/lib/pagination";

const q = (s: string) => new URLSearchParams(s);

describe("parsePageRequest", () => {
  it("reads page and pageSize", () => {
    expect(parsePageRequest(q("page=3&pageSize=50"))).toEqual({ page: 3, pageSize: 50 });
    expect(parsePageRequest(q("page=1&pageSize=10"))).toEqual({ page: 1, pageSize: 10 });
    expect(PAGE_SIZE_OPTIONS).toContain(10);
  });
  it("falls back on garbage, zero, negatives and unoffered sizes", () => {
    expect(parsePageRequest(q("page=abc&pageSize=x"))).toEqual({ page: 1, pageSize: 25 });
    expect(parsePageRequest(q("page=0&pageSize=7"))).toEqual({ page: 1, pageSize: 25 });
    expect(parsePageRequest(q("page=-4&pageSize=100000"))).toEqual({ page: 1, pageSize: 25 });
  });
  it("accepts a Next searchParams object and a default size", () => {
    expect(parsePageRequest({ page: ["2", "9"], pageSize: "100" })).toEqual({ page: 2, pageSize: 100 });
    expect(parsePageRequest({}, { pageSize: 50 })).toEqual({ page: 1, pageSize: 50 });
  });
});

describe("paginate", () => {
  const rows = Array.from({ length: 60 }, (_, i) => i + 1);
  it("cuts a page and reports the real total", () => {
    expect(paginate(rows, { page: 2, pageSize: 25 })).toMatchObject({ items: rows.slice(25, 50), total: 60, page: 2, pageCount: 3 });
  });
  it("a page past the end shows the last page", () => {
    const r = paginate(rows, { page: 99, pageSize: 25 });
    expect(r.page).toBe(3);
    expect(r.items).toEqual(rows.slice(50));
  });
  it("an empty list is page 1 of 1", () => expect(paginate([], { page: 5, pageSize: 25 })).toEqual({ items: [], total: 0, page: 1, pageSize: 25, pageCount: 1 }));
});

describe("pageWindow", () => {
  it("shows every page when there are few", () => expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]));
  it("collapses the middle with gaps", () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, null, 20]);
    expect(pageWindow(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(pageWindow(20, 20)).toEqual([1, null, 17, 18, 19, 20]);
  });
});
