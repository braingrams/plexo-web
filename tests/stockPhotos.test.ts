import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

// SOL's app_find_photos: real, on-topic photos from Plexo's own stock accounts, cached a day.

const cache = vi.hoisted(() => new Map<string, { createdAt: string; results: unknown }>());
vi.mock("@/lib/db/opsEntities", () => ({
  StockCache: {
    get: ({ provider, query }: { provider: string; query: string }) => ({ go: async () => ({ data: cache.get(`${provider}|${query}`) ?? null }) }),
    remove: ({ provider, query }: { provider: string; query: string }) => ({ go: async () => cache.delete(`${provider}|${query}`) }),
    create: (row: { provider: string; query: string; results: unknown }) => ({ go: async () => cache.set(`${row.provider}|${row.query}`, { createdAt: new Date().toISOString(), results: row.results }) }),
  },
}));

import { findStockPhotos } from "@/lib/media/stockPhotos";

const unsplash = (n: number, wide = true) => ({
  results: Array.from({ length: n }, (_, i) => ({ urls: { regular: `https://images.unsplash.com/p${i}` }, alt_description: `latte art ${i}`, user: { name: `Ana ${i}` }, links: { html: `https://unsplash.com/photos/${i}` }, width: wide ? 3000 : 2000, height: wide ? 2000 : 3000 })),
});
const pexels = { photos: [{ src: { large2x: "https://images.pexels.com/x" }, alt: "coffee bar", photographer: "Ben", url: "https://pexels.com/x", width: 4000, height: 2600 }] };

beforeEach(() => {
  cache.clear();
  process.env.UNSPLASH_KEY = "u";
  process.env.PEXELS_KEY = "p";
  delete process.env.PIXABAY_KEY;
});

describe("finding photos for an app", () => {
  it("returns real photos with credits, best source first, topping up from the next", async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("unsplash") ? unsplash(2) : pexels), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const photos = await findStockPhotos("Barista pouring latte art", { count: 3 });
    expect(photos.map((p) => p.url)).toEqual(["https://images.unsplash.com/p0", "https://images.unsplash.com/p1", "https://images.pexels.com/x"]);
    expect(photos[0].credit).toBe("Ana 0 on Unsplash");
  });

  it("keeps to the orientation asked for", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(unsplash(3, false)), { status: 200 })));
    process.env.PEXELS_KEY = "";
    expect(await findStockPhotos("tall portrait", { orientation: "landscape" })).toEqual([]);
    expect((await findStockPhotos("tall portrait", { orientation: "portrait" })).length).toBe(3);
  });

  it("serves a repeat search from the cache", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(unsplash(6)), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await findStockPhotos("dental clinic");
    await findStockPhotos("dental clinic");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is empty, not an error, with no accounts or a failing provider", async () => {
    process.env.UNSPLASH_KEY = "";
    process.env.PEXELS_KEY = "";
    expect(await findStockPhotos("anything")).toEqual([]);
    process.env.UNSPLASH_KEY = "u";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await findStockPhotos("anything else")).toEqual([]);
  });
});
