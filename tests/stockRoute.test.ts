import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

// The editor's photo picker (/api/v1/media/stock): a search goes to the photo service once, then comes from our own
// database; a service that just refused us isn't asked again straight away, and older saved results cover for it.

const cache = vi.hoisted(() => new Map<string, { createdAt: string; results: unknown }>());
vi.mock("@/lib/db/opsEntities", () => ({
  StockCache: {
    get: ({ provider, query }: { provider: string; query: string }) => ({ go: async () => ({ data: cache.get(`${provider}|${query}`) ?? null }) }),
    remove: ({ provider, query }: { provider: string; query: string }) => ({ go: async () => cache.delete(`${provider}|${query}`) }),
    create: (row: { provider: string; query: string; results: unknown }) => ({ go: async () => cache.set(`${row.provider}|${row.query}`, { createdAt: new Date().toISOString(), results: row.results }) }),
  },
}));
vi.mock("@/lib/auth/resolveUser", () => ({ resolveUser: async () => ({ userId: "u1" }) }));

import { GET } from "@/app/api/v1/media/stock/route";

const search = (q = "nature", provider = "unsplash") => GET(new NextRequest(`https://plexo.test/api/v1/media/stock?query=${q}&provider=${provider}`));
const ok = () => new Response(JSON.stringify({ results: [{ id: "a", urls: { regular: "https://images.unsplash.com/a" }, alt_description: "tree", user: { name: "Ana" }, links: { html: "https://unsplash.com/a" } }] }), { status: 200 });
const old = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

beforeEach(() => {
  cache.clear();
  process.env.UNSPLASH_KEY = "u";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("photo search caching", () => {
  it("asks the photo service once, then serves the same search from the database", async () => {
    const f = vi.fn(async () => ok());
    vi.stubGlobal("fetch", f);
    expect((await (await search()).json()).length).toBe(1);
    expect((await (await search()).json()).length).toBe(1);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("keeps results for a week, and refreshes them after that", async () => {
    const f = vi.fn(async () => ok());
    vi.stubGlobal("fetch", f);
    cache.set("unsplash|nature", { createdAt: old(5), results: [{ id: "old", src: "https://x/old", alt: "", provider: "unsplash", credit: "", source: "" }] });
    expect((await (await search()).json())[0].id).toBe("old");
    expect(f).not.toHaveBeenCalled();
    cache.set("unsplash|nature", { createdAt: old(8), results: [{ id: "old", src: "https://x/old", alt: "", provider: "unsplash", credit: "", source: "" }] });
    expect((await (await search()).json())[0].id).toBe("unsplash-a");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("doesn't keep asking a service that just said no, and says why", async () => {
    const f = vi.fn(async () => new Response("Rate Limit Exceeded", { status: 403 }));
    vi.stubGlobal("fetch", f);
    const first = await search();
    expect(first.status).toBe(502);
    expect((await first.json()).error).toMatch(/hourly limit/);
    const second = await search();
    expect(second.status).toBe(502);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("falls back to older saved results when the service refuses a refresh", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    cache.set("unsplash|nature", { createdAt: old(9), results: [{ id: "old", src: "https://x/old", alt: "", provider: "unsplash", credit: "", source: "" }] });
    const res = await search();
    expect(res.status).toBe(200);
    expect((await res.json())[0].id).toBe("old");
  });
});
