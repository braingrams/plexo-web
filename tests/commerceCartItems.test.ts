import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

// Adding to the cart: a digital product (a course) can be bought; a service can't (it's booked);
// "replace" starts the cart fresh so Buy now pays for exactly one product.

const h = vi.hoisted(() => ({
  products: new Map<string, Record<string, any>>(),
  items: [] as Record<string, any>[],
}));

vi.mock("@/lib/pub/resolveSiteDynamo", () => ({ resolveSite: vi.fn(async () => ({ status: "ok", published: { templateId: "site", organization: { id: "o1" } } })) }));
vi.mock("@/lib/commerceRateLimitDynamo", () => ({ checkCommerceRateLimit: vi.fn(async () => true), clientIp: () => "1.1.1.1" }));
vi.mock("@/lib/commerce/cartDynamo", () => ({
  readCartToken: () => "tok",
  setCartCookie: () => {},
  findOpenCart: async () => ({ id: "cart-1", cartToken: "tok" }),
  createCart: async () => ({ id: "cart-1", cartToken: "tok" }),
  readCartSnapshot: async () => ({ cartToken: "tok", items: h.items.map((i) => ({ productId: i.productId, quantity: i.quantity })), subtotalMinor: 0, currency: "NGN" }),
}));
vi.mock("@/lib/db/commerceEntities", () => ({
  CommerceProduct: { get: ({ id }: { id: string }) => ({ go: async () => ({ data: h.products.get(id) ?? null }) }) },
  CommerceCartItem: {
    query: { primary: () => ({ go: async () => ({ data: [...h.items] }) }) },
    remove: ({ id }: { id: string }) => ({ go: async () => { h.items = h.items.filter((i) => i.id !== id); return {}; } }),
    create: (row: Record<string, any>) => ({ go: async () => { h.items.push(row); return { data: row }; } }),
    patch: ({ id }: { id: string }) => ({ set: (v: Record<string, any>) => ({ go: async () => { Object.assign(h.items.find((i) => i.id === id)!, v); return {}; } }) }),
  },
}));

import { POST } from "@/app/api/public/commerce/cart/items/route";

const post = (body: unknown) => POST(new Request("https://course.pages.test/api/public/commerce/cart/items", { method: "POST", headers: { host: "course.pages.test" }, body: JSON.stringify(body) }) as any);

beforeEach(() => {
  h.items = [];
  h.products.clear();
  h.products.set("course", { id: "course", name: "AI Video Course", kind: "DIGITAL", priceMinor: 500000, active: true });
  h.products.set("tee", { id: "tee", name: "Tee", kind: "PHYSICAL", priceMinor: 100000, stockQuantity: 3, active: true });
  h.products.set("call", { id: "call", name: "Consultation", kind: "SERVICE", priceMinor: 100000, active: true });
});

describe("POST /api/public/commerce/cart/items", () => {
  it("lets a digital product into the cart, always as one", async () => {
    const res = await post({ productId: "course", quantity: 5 });
    expect(res.status).toBe(201);
    expect(h.items).toHaveLength(1);
    expect(h.items[0]).toMatchObject({ productId: "course", quantity: 1, unitPriceMinorSnapshot: 500000 });
    await post({ productId: "course" });
    expect(h.items).toHaveLength(1);
    expect(h.items[0].quantity).toBe(1);
  });

  it("still sends a service to be booked, not carted", async () => {
    const res = await post({ productId: "call" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/booked directly/);
    expect(h.items).toHaveLength(0);
  });

  it("still refuses a physical product that's sold out", async () => {
    h.products.get("tee")!.stockQuantity = 0;
    expect((await post({ productId: "tee" })).status).toBe(409);
  });

  it("replace starts the cart fresh, so Buy now pays for exactly that product", async () => {
    await post({ productId: "tee", quantity: 2 });
    expect(h.items).toHaveLength(1);
    await post({ productId: "course", replace: true });
    expect(h.items.map((i) => i.productId)).toEqual(["course"]);
  });

  it("keeps the rest of the cart when not replacing", async () => {
    await post({ productId: "tee", quantity: 2 });
    await post({ productId: "course" });
    expect(h.items.map((i) => i.productId).sort()).toEqual(["course", "tee"]);
  });
});
