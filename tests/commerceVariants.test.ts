import { describe, expect, it, vi } from "vitest";

// stock.ts builds its DynamoDB update from ElectroDB's key params — stub just that.
vi.mock("@/lib/db/client", () => ({ docClient: { send: vi.fn() }, TABLES: {} }));
vi.mock("@/lib/db/commerceEntities", () => ({
  CommerceProduct: {
    get: ({ templateId, id }: { templateId: string; id: string }) => ({
      params: () => ({ TableName: "commerce", Key: { pk: `template#${templateId}`, sk: `product#${id}` } }),
      go: async () => ({ data: null }),
    }),
    patch: () => ({ add: () => ({ where: () => ({ params: () => "product-level" }) }) }),
  },
}));

import {
  VariantInputError,
  catalogFieldsFromInput,
  listingPriceAndStock,
  normalizeOptionsAndVariants,
  publicVariantView,
  resolvePurchasable,
  variantLabel,
} from "@/lib/commerce/variants";
import { takeStockTransactItem } from "@/lib/commerce/stock";
import { syncVariantRows, variantPayload } from "@/app/dashboard/commerce/[templateId]/products/VariantsEditor";

const options = [
  { name: "Size", values: ["S", "M"] },
  { name: "Colour", values: ["Red", "Blue"] },
];
const tee = {
  name: "Classic Tee",
  priceMinor: 500000,
  sku: "TEE",
  imageUrl: "/tee.png",
  options,
  variants: [
    { id: "v-s-red", options: { Size: "S", Colour: "Red" }, priceMinor: 500000, stockQuantity: 3, sku: "TEE-S-R" },
    { id: "v-m-red", options: { Size: "M", Colour: "Red" }, priceMinor: 550000, compareAtPriceMinor: 700000, stockQuantity: 0, imageUrl: "/red.png" },
    { id: "v-m-blue", options: { Colour: "Blue", Size: "M" }, priceMinor: 550000, stockQuantity: null, active: false },
  ],
};

describe("resolvePurchasable", () => {
  it("a simple product is bought as itself", () => {
    const r = resolvePurchasable({ name: "Mug", priceMinor: 200000, stockQuantity: 4, sku: "MUG" });
    expect(r).toMatchObject({ ok: true, variant: null, unitPriceMinor: 200000, stockQuantity: 4, label: null, sku: "MUG" });
  });

  it("a product with options needs a choice, explained in the shopper's words", () => {
    const r = resolvePurchasable(tee, null);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("Please choose size and colour for Classic Tee.");
  });

  it("uses the variant's own price, stock, SKU (falling back to the product's) and photo", () => {
    expect(resolvePurchasable(tee, "v-m-red")).toMatchObject({ ok: true, unitPriceMinor: 550000, stockQuantity: 0, label: "Size: M / Colour: Red", sku: "TEE", imageUrl: "/red.png" });
    expect(resolvePurchasable(tee, "v-s-red")).toMatchObject({ sku: "TEE-S-R", imageUrl: "/tee.png" });
  });

  it("refuses a variant that's switched off or no longer exists", () => {
    expect(resolvePurchasable(tee, "v-m-blue").ok).toBe(false);
    expect(resolvePurchasable(tee, "gone").ok).toBe(false);
  });

  it("labels follow the product's option order whatever order the variant stored them in", () => {
    expect(variantLabel(tee, { id: "x", options: { Colour: "Blue", Size: "M" }, priceMinor: 1 })).toBe("Size: M / Colour: Blue");
  });
});

describe("listing price and stock", () => {
  it("shows the cheapest active variant with its sale price, and stock summed across tracked variants", () => {
    const view = listingPriceAndStock({ ...tee, variants: tee.variants.slice(0, 2) });
    expect(view).toMatchObject({ priceMinor: 500000, hasVariants: true, stockQuantity: 3, priceRange: { minMinor: 500000, maxMinor: 550000 } });
  });

  it("an untracked variant means the product is never 'out of stock'", () => {
    expect(listingPriceAndStock({ ...tee, variants: [{ ...tee.variants[0], stockQuantity: null }] }).stockQuantity).toBeNull();
  });

  it("only shows a sale price above the current price", () => {
    expect(listingPriceAndStock({ name: "x", priceMinor: 100, compareAtPriceMinor: 90 }).compareAtPriceMinor).toBeNull();
    expect(listingPriceAndStock({ name: "x", priceMinor: 100, compareAtPriceMinor: 150 }).compareAtPriceMinor).toBe(150);
  });

  it("the storefront never sees switched-off variants", () => {
    expect(publicVariantView(tee).variants.map((v) => v.id)).toEqual(["v-s-red", "v-m-red"]);
  });
});

describe("normalizeOptionsAndVariants / catalogFieldsFromInput", () => {
  it("keeps a variant's id when it's passed back, and mints one for a new combination", () => {
    const { variants } = normalizeOptionsAndVariants(options, [
      { id: "keep-me", options: { Size: "s", Colour: "red" }, priceMinor: 100 },
      { options: { Size: "M", Colour: "Blue" }, priceMinor: 200, compareAtPriceMinor: 150 },
    ]);
    expect(variants[0]).toMatchObject({ id: "keep-me", options: { Size: "S", Colour: "Red" } }); // values normalised to the option's spelling
    expect(variants[1].id).toMatch(/[0-9a-f-]{36}/);
    expect(variants[1].compareAtPriceMinor).toBeNull(); // a "was" price below the price isn't a sale
  });

  it.each([
    [[{ options: { Size: "XL", Colour: "Red" }, priceMinor: 1 }], "needs a Size"],
    [[{ options: { Size: "S", Colour: "Red" }, priceMinor: 1 }, { options: { Size: "S", Colour: "Red" }, priceMinor: 2 }], "Two variants"],
    [[{ options: { Size: "S", Colour: "Red" }, priceMinor: -1 }], "price must be a whole number"],
    [[], "Add at least one variant"],
  ])("explains what's wrong (%#)", (variants, message) => {
    expect(() => normalizeOptionsAndVariants(options, variants)).toThrow(message as string);
  });

  it("with variants, the product's price follows its cheapest active variant and its own stock is dropped", () => {
    const { set, remove } = catalogFieldsFromInput(
      {
        options,
        variants: [
          { options: { Size: "S", Colour: "Red" }, priceMinor: 900, active: false },
          { options: { Size: "M", Colour: "Red" }, priceMinor: 1200 },
        ],
      },
      { kind: "PHYSICAL", priceMinor: 5000 },
    );
    expect(set.priceMinor).toBe(1200);
    expect(remove).toContain("stockQuantity");
  });

  it("empty options/variants removes them; services can't have them", () => {
    expect(catalogFieldsFromInput({ options: [], variants: [] }, { kind: "PHYSICAL", priceMinor: 1 }).remove).toEqual(expect.arrayContaining(["options", "variants"]));
    expect(() => catalogFieldsFromInput({ options, variants: [{ options: { Size: "S", Colour: "Red" }, priceMinor: 1 }] }, { kind: "SERVICE", priceMinor: 1 })).toThrow(VariantInputError);
  });
});

describe("takeStockTransactItem", () => {
  const product = { ...tee, id: "p1", templateId: "site1" } as unknown as Parameters<typeof takeStockTransactItem>[0];

  it("updates the variant at its real list position, guarded by its id and an enough-left check", () => {
    const step = takeStockTransactItem(product, "v-s-red", 2) as { Update: { UpdateExpression: string; ConditionExpression: string; ExpressionAttributeValues: Record<string, unknown>; Key: unknown } };
    expect(step.Update.UpdateExpression).toBe("SET #v[0].#q = #v[0].#q + :delta");
    expect(step.Update.ConditionExpression).toBe("#v[0].#id = :vid AND #v[0].#q >= :need");
    expect(step.Update.ExpressionAttributeValues).toEqual({ ":delta": -2, ":vid": "v-s-red", ":need": 2 });
    expect(step.Update.Key).toEqual({ pk: "template#site1", sk: "product#p1" });
  });

  it("nothing to take for an untracked variant", () => {
    expect(takeStockTransactItem(product, "v-m-blue", 1)).toBeNull();
  });

  it("a simple product uses its own stock count", () => {
    expect(takeStockTransactItem({ ...product, variants: undefined, stockQuantity: 5 }, null, 1)).toEqual({ Update: "product-level" });
  });
});

describe("dashboard variants editor", () => {
  it("one row per combination, keeping what was typed when options are renamed or extended", () => {
    let rows = syncVariantRows([{ name: "Size", values: "S, M" }], [], { price: "50" });
    expect(rows.map((r) => r.options)).toEqual([{ Size: "S" }, { Size: "M" }]);
    rows = rows.map((r) => (r.options.Size === "M" ? { ...r, price: "65", id: "v-m" } : r));
    rows = syncVariantRows([{ name: "Sizes", values: "S, M, L" }], rows, { price: "50" });
    expect(rows.find((r) => r.options.Sizes === "M")).toMatchObject({ price: "65", id: "v-m" });
    expect(rows).toHaveLength(3);
  });

  it("turns rows into the API payload in minor units, or says what's missing", () => {
    const rows = syncVariantRows([{ name: "Size", values: "S" }], [], { price: "12.5" });
    expect(variantPayload([{ name: "Size", values: "S" }], rows)).toMatchObject({ variants: [{ options: { Size: "S" }, priceMinor: 1250, stockQuantity: null }] });
    expect(variantPayload([{ name: "", values: "S" }], rows)).toBe("Give every option a name (e.g. Size).");
  });
});
