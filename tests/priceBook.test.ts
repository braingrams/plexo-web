import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ row: null as unknown, gets: 0, fail: false }));
vi.mock("@/lib/db/coreEntities", () => ({
  PriceBookRecord: { get: () => ({ go: async () => { st.gets++; if (st.fail) throw new Error("db down"); return { data: st.row }; } }) },
}));

import { PRICE_BOOK_TTL_MS, invalidatePriceBookCache, loadPriceBook } from "@/lib/billing/priceBook";
import { DEFAULT_PRICE_BOOK, planPrice, type PriceBook } from "@/lib/billing/pricing";

const edited = (starter: number): PriceBook => ({
  ...DEFAULT_PRICE_BOOK,
  version: 3,
  groups: DEFAULT_PRICE_BOOK.groups.map((g) => (g.id === "WORLD" ? { ...g, monthly: { ...g.monthly, STARTER: starter }, yearly: { ...g.yearly, STARTER: starter * 10 } } : g)),
});
const world = (b: PriceBook) => b.groups.find((g) => g.id === "WORLD")!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  st.gets = 0; st.fail = false; st.row = null;
  invalidatePriceBookCache();
});
afterEach(() => vi.useRealTimers());

describe("price lookup and cache", () => {
  it("falls back to the built-in book when nothing is stored", async () => {
    expect(await loadPriceBook()).toBe(DEFAULT_PRICE_BOOK);
  });
  it("serves from cache for 60s, then reloads", async () => {
    st.row = edited(10);
    expect(planPrice(world(await loadPriceBook()), "STARTER", "monthly")).toBe(10);
    st.row = edited(12);
    expect(planPrice(world(await loadPriceBook()), "STARTER", "monthly")).toBe(10);
    expect(st.gets).toBe(1);
    vi.advanceTimersByTime(PRICE_BOOK_TTL_MS + 1);
    expect(planPrice(world(await loadPriceBook()), "STARTER", "monthly")).toBe(12);
  });
  it("checkout (fresh) and invalidation always see the latest save", async () => {
    st.row = edited(10);
    await loadPriceBook();
    st.row = edited(11);
    expect(planPrice(world(await loadPriceBook({ fresh: true })), "STARTER", "monthly")).toBe(11);
    st.row = edited(13);
    invalidatePriceBookCache();
    expect(planPrice(world(await loadPriceBook()), "STARTER", "monthly")).toBe(13);
  });
  it("an invalid saved book is ignored, and a database error keeps the last good prices", async () => {
    st.row = { ...edited(10), groups: [] };
    expect(await loadPriceBook()).toBe(DEFAULT_PRICE_BOOK);
    st.row = edited(10);
    await loadPriceBook({ fresh: true });
    st.fail = true;
    expect(planPrice(world(await loadPriceBook({ fresh: true })), "STARTER", "monthly")).toBe(10);
  });
});
