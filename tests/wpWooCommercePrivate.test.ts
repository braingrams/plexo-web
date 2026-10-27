import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-ins for the Commerce tables the plugin importers write.
const { db } = vi.hoisted(() => ({ db: { discounts: [] as any[], delivery: [] as any[], orders: [] as any[], items: [] as any[], products: new Map<string, any>(), settings: null as any } }));
vi.mock("@/lib/db/commerceEntities", () => {
  const putter = (list: any[]) => ({ put: (v: any) => ({ go: async () => list.push(v) }), create: (v: any) => ({ go: async () => { if (list.some((x) => x.id === v.id)) throw new Error("The conditional request failed"); list.push(v); } }) });
  return {
    CommerceDiscountCode: putter(db.discounts),
    CommerceDeliveryMethod: putter(db.delivery),
    CommerceOrder: putter(db.orders),
    CommerceOrderItem: putter(db.items),
    CommerceProduct: {
      get: ({ id }: { id: string }) => ({ go: async () => ({ data: db.products.get(id) ?? null }) }),
      patch: ({ id }: { id: string }) => ({ set: (v: any) => ({ go: async () => db.products.set(id, { ...db.products.get(id), ...v }) }) }),
    },
    CommerceSettings: {
      get: () => ({ go: async () => ({ data: db.settings }) }),
      patch: () => ({ set: (v: any) => ({ go: async () => { db.settings = { ...db.settings, ...v }; } }) }),
    },
    CommerceCategory: {},
    CommerceProductReview: {},
  };
});
vi.mock("@/lib/db/contentEntities", () => ({ Template: {} }));
vi.mock("@/lib/db/importEntities", () => ({ WpMigrationJob: {}, WpMigrationPage: {} }));
vi.mock("@/lib/commerce/storefrontLayout", () => ({}));
vi.mock("@/lib/commerce/productDetailLayout", () => ({}));
vi.mock("@/lib/blogImport/mediaRehostDynamo", () => ({}));
vi.mock("@/lib/storage", () => ({ uploadObject: vi.fn(async (path: string) => ({ url: `https://bucket/private/${path}` })) }));

import { applyWcProductExtras, importWcCoupons, importWcOrders, importWcShipping } from "@/lib/wpMigration/storeImport";

const job = { templateId: "site1", organizationId: "org1", id: "job1" } as never;

beforeEach(() => {
  db.discounts.length = db.delivery.length = db.orders.length = db.items.length = 0;
  db.products.clear();
  db.settings = { id: "s", templateId: "site1" };
});

describe("coupons", () => {
  it("become discount codes; conditions Plexo doesn't have are named for the owner", async () => {
    const notes: string[] = [];
    // Exactly what the plugin returned for the test store's two coupons.
    const n = await importWcCoupons(job, [
      { id: 70, code: "save10", discount_type: "percent", amount: 10, date_expires: null, usage_limit: 50, usage_count: 4, minimum_amount: 20, maximum_amount: 0, free_shipping: false, product_ids: [], product_categories: [], email_restrictions: [], usage_limit_per_user: null },
      { id: 71, code: "fiveoff", discount_type: "fixed_cart", amount: 5, date_expires: "2027-12-31T00:00:00+00:00", usage_limit: 0, usage_count: 0, minimum_amount: 0, maximum_amount: 0, free_shipping: false, product_ids: [], product_categories: [], email_restrictions: [], usage_limit_per_user: null },
    ], notes);
    expect(n).toBe(2);
    expect(db.discounts[0]).toMatchObject({ code: "SAVE10", type: "PERCENT", value: 10, usageLimit: 50, usedCount: 4 });
    expect(db.discounts[1]).toMatchObject({ code: "FIVEOFF", type: "FIXED", value: 500, expiresAt: "2027-12-31T00:00:00.000Z" });
    expect(db.discounts[1].usageLimit).toBeUndefined();
    expect(notes).toEqual(["Coupon SAVE10 had a minimum spend of 20 on WooCommerce — on Plexo it applies to any order."]);
  });
});

describe("shipping", () => {
  it("zones become delivery methods by area (state names, not codes); pickup once, at the store address", async () => {
    const notes: string[] = [];
    const n = await importWcShipping(job, [
      { id: 1, name: "Lagos", locations: [{ type: "state", code: "NG:LA", country: "NG", state_name: "Lagos" }], methods: [
        { type: "flat_rate", title: "Lagos delivery", enabled: true, cost: "15", min_amount: "", requires: "" },
        { type: "local_pickup", title: "Local pickup", enabled: true, cost: "", min_amount: "", requires: "" },
      ] },
      { id: 0, name: "Everywhere else", locations: [], methods: [{ type: "free_shipping", title: "Free worldwide shipping", enabled: true, cost: "", min_amount: "100", requires: "min_amount" }] },
    ], "1 Marina, Lagos", notes);
    expect(n).toBe(3);
    expect(db.delivery[0]).toMatchObject({ name: "Lagos delivery", type: "COURIER", feeMinor: 1500, countries: ["NG"], states: ["LAGOS"] });
    expect(db.delivery[1]).toMatchObject({ type: "PICKUP", description: "1 Marina, Lagos" });
    expect(db.delivery[2]).toMatchObject({ name: "Free worldwide shipping", type: "COURIER", feeMinor: 0 });
    expect(db.delivery[2].countries).toBeUndefined(); // worldwide
    expect(db.settings).toMatchObject({ deliveryEnabled: true, pickupEnabled: true, pickupLocation: "1 Marina, Lagos" });
    expect(notes[0]).toMatch(/free only on orders over 100/);
  });

  it("a formula cost is flagged rather than guessed", async () => {
    const notes: string[] = [];
    await importWcShipping(job, [{ id: 2, name: "UK", locations: [{ type: "country", code: "GB" }], methods: [{ type: "flat_rate", title: "Royal Mail", enabled: true, cost: "2 * [qty]", min_amount: "", requires: "" }] }], "", notes);
    expect(db.delivery[0]).toMatchObject({ feeMinor: 0, countries: ["GB"] });
    expect(notes[0]).toMatch(/formula/);
  });
});

describe("orders", () => {
  const order = {
    id: 66, number: "66", status: "completed", created: "2026-10-07T15:00:00+00:00", currency: "USD", total: 78, discount_total: 0, shipping_total: 0, shipping_method: "",
    payment_method_title: "Card", email: "Ada@Example.com", name: "Ada Lovelace", phone: "+2348000000000", country: "NG", state: "LA", state_name: "Lagos", address: "1 Marina, Lagos", note: "",
    items: [
      { name: "T-Shirt", product_id: 20, variation_id: 0, quantity: 2, total: 36, sku: "woo-tshirt" },
      { name: "Hoodie - Red, No", product_id: 18, variation_id: 34, quantity: 1, total: 42, sku: "woo-hoodie-red" },
    ],
  };

  it("become order history linked to the moved products and variants — once, even on a re-run", async () => {
    const ids = new Map([[20, "plexo-tee"], [18, "plexo-hoodie"]]);
    expect(await importWcOrders(job, [order], ids)).toBe(1);
    expect(await importWcOrders(job, [order], ids)).toBe(0);
    expect(db.orders).toHaveLength(1);
    expect(db.orders[0]).toMatchObject({ orderNumber: "WC-66", status: "PAID", fulfillmentStatus: "COMPLETED", amountMinor: 7800, customerEmail: "ada@example.com", shippingState: "LAGOS", metadata: { imported: true } });
    expect(db.items).toEqual([
      expect.objectContaining({ productId: "plexo-tee", quantity: 2, unitPriceMinor: 1800, sku: "woo-tshirt" }),
      expect.objectContaining({ productId: "plexo-hoodie", variantId: "wc-34", unitPriceMinor: 4200 }),
    ]);
  });

  it.each([["processing", "PAID", "PROCESSING"], ["refunded", "REFUNDED", "UNFULFILLED"], ["on-hold", "PENDING", "UNFULFILLED"]])("%s → %s/%s", async (wc, status, fulfillment) => {
    await importWcOrders(job, [{ ...order, status: wc }], new Map());
    expect(db.orders[0]).toMatchObject({ status, fulfillmentStatus: fulfillment });
  });
});

describe("stock and downloads", () => {
  it("exact stock per variation, and a download becomes a digital product with its file copied privately", async () => {
    db.products.set("plexo-hoodie", { id: "plexo-hoodie", name: "Hoodie", variants: [{ id: "wc-34", stockQuantity: null }, { id: "wc-35", stockQuantity: null }] });
    db.products.set("plexo-album", { id: "plexo-album", name: "Album", kind: "PHYSICAL" });
    const notes: string[] = [];
    const res = await applyWcProductExtras(
      job,
      [
        { id: 18, manage_stock: false, stock_quantity: null, stock_status: "instock", virtual: false, downloadable: false, downloads: [], download_limit: -1, download_expiry: -1, variations: [{ id: 34, manage_stock: true, stock_quantity: 2, stock_status: "instock" }, { id: 35, manage_stock: false, stock_quantity: null, stock_status: "outofstock" }] },
        { id: 29, manage_stock: false, stock_quantity: null, stock_status: "instock", virtual: true, downloadable: true, downloads: [{ id: "album-1", name: "Album (ZIP)", file: "https://shop/wp-content/uploads/woocommerce_uploads/album.zip" }], download_limit: 3, download_expiry: -1, variations: [] },
      ],
      new Map([[18, "plexo-hoodie"], [29, "plexo-album"]]),
      async () => ({ body: Buffer.from("PLEXOALBUM"), name: "album.zip" }),
      notes,
    );
    expect(res).toEqual({ stock: 1, digital: 1 });
    expect(db.products.get("plexo-hoodie").variants).toEqual([{ id: "wc-34", stockQuantity: 2 }, { id: "wc-35", stockQuantity: 0 }]);
    expect(db.products.get("plexo-album")).toMatchObject({ kind: "DIGITAL", digitalDeliveryMethod: "FILE_DOWNLOAD", digitalFileName: "Album (ZIP)", digitalMaxDownloads: 3, digitalFileSizeBytes: 10 });
    expect(db.products.get("plexo-album").digitalFileUrl).toMatch(/^https:\/\/bucket\/private\//);
    expect(notes).toEqual([]);
  });
});
