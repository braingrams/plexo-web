import { afterEach, describe, expect, it, vi } from "vitest";
import { isOtherProduct, productOf, withProduct } from "@/lib/paystackProduct";
import { initializePaystackTransaction } from "@/lib/paystack";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Paystack product tag", () => {
  it("adds product and dashboard custom_fields to a charge's metadata without touching the rest, and keeps one set on purpose", () => {
    expect(withProduct({ kind: "plan" })).toEqual({
      product: "plexo",
      kind: "plan",
      custom_fields: [{ display_name: "Product", variable_name: "product", value: "Plexo" }],
    });
    expect(withProduct(undefined)).toEqual({
      product: "plexo",
      custom_fields: [{ display_name: "Product", variable_name: "product", value: "Plexo" }],
    });
    expect(withProduct({ product: "maildrip" })).toEqual({
      product: "maildrip",
      custom_fields: [{ display_name: "Product", variable_name: "product", value: "Maildrip" }],
    });
  });

  it("preserves existing custom_fields and does not duplicate product field if already present", () => {
    const existing = [{ display_name: "Order ID", variable_name: "order_id", value: "ord_123" }];
    expect(withProduct({ custom_fields: existing })).toEqual({
      product: "plexo",
      custom_fields: [
        { display_name: "Order ID", variable_name: "order_id", value: "ord_123" },
        { display_name: "Product", variable_name: "product", value: "Plexo" },
      ],
    });

    const withProductField = [
      { display_name: "Product", variable_name: "product", value: "CustomProduct" },
    ];
    expect(withProduct({ custom_fields: withProductField })).toEqual({
      product: "plexo",
      custom_fields: withProductField,
    });
  });

  it("tells whose an event is, and only drops one that clearly belongs to another product", () => {
    expect(productOf({ product: " Plexo " })).toBe("plexo");
    expect(productOf({ custom_fields: [{ variable_name: "product", value: "Maildrip" }] })).toBe("maildrip");
    expect(isOtherProduct({ product: "maildrip" })).toBe(true);
    expect(isOtherProduct({ custom_fields: [{ variable_name: "product", value: "Maildrip" }] })).toBe(true);
    expect(isOtherProduct({ product: "plexo" })).toBe(false);
    expect(isOtherProduct({ custom_fields: [{ variable_name: "product", value: "Plexo" }] })).toBe(false);
    for (const untagged of [undefined, null, {}, { kind: "plan" }, { product: "" }, "x"]) expect(isOtherProduct(untagged)).toBe(false);
  });

  it("tags charges made with Charisol's own key, not a Commerce site's own Paystack account", async () => {
    vi.stubEnv("PLATFORM_PAYSTACK_SECRET_KEY", "sk_platform");
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ status: true, data: { authorization_url: "u", access_code: "a", reference: "r" } }) };
    });
    const base = { email: "a@b.co", amountMinor: 100, currency: "NGN", reference: "r", callbackUrl: "https://x" };
    await initializePaystackTransaction({ ...base, secretKey: "sk_platform", metadata: { kind: "topup" } });
    await initializePaystackTransaction({ ...base, secretKey: "sk_merchant_own", metadata: { kind: "order" } });
    expect(bodies[0].metadata).toEqual({
      product: "plexo",
      kind: "topup",
      custom_fields: [{ display_name: "Product", variable_name: "product", value: "Plexo" }],
    });
    expect(bodies[1].metadata).toEqual({ kind: "order" });
  });
});
