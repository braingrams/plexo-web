// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Runs the real storefront script (public/commerce.js) in a browser-like DOM against a
// product with options, clicking the pickers the way a shopper would.

const product = {
  id: "p1",
  name: "Classic Tee",
  slug: "classic-tee",
  description: "Soft cotton.",
  imageUrl: "/tee.png",
  kind: "PHYSICAL",
  currency: "NGN",
  priceMinor: 500000,
  compareAtPriceMinor: null,
  stockQuantity: 3,
  hasVariants: true,
  priceRange: { minMinor: 500000, maxMinor: 550000 },
  options: [
    { name: "Size", values: ["S", "M"] },
    { name: "Colour", values: ["Red", "Blue"] },
  ],
  variants: [
    { id: "v-s-red", options: { Size: "S", Colour: "Red" }, priceMinor: 500000, compareAtPriceMinor: null, stockQuantity: 3, imageUrl: null },
    { id: "v-m-red", options: { Size: "M", Colour: "Red" }, priceMinor: 550000, compareAtPriceMinor: 700000, stockQuantity: 2, imageUrl: "/red-m.png" },
    { id: "v-m-blue", options: { Size: "M", Colour: "Blue" }, priceMinor: 550000, compareAtPriceMinor: null, stockQuantity: 0, imageUrl: null },
  ],
  category: null,
};

let posted: Record<string, unknown>[] = [];

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  posted = [];
  document.body.innerHTML = `<div id="detail" data-plexo-commerce-product data-plexo-commerce-mode="detail"></div>`;
  window.history.pushState({}, "", "/shop/classic-tee");
  window.alert = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/public/commerce/products/"))
        return respond({ product, relatedProducts: [], reviews: { count: 2, average: 4.5, items: [{ name: "Ada", rating: 5, body: "Lovely fit.", date: "2026-09-01T00:00:00Z" }, { name: "Tunde", rating: 4, body: "Good.", date: null }] } });
      if (url === "/api/public/commerce/cart/items" && init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)));
        return respond({ cartToken: "t", items: [], subtotalMinor: 0, currency: "NGN" });
      }
      if (url.startsWith("/api/public/commerce/cart")) return respond({ cartToken: null, items: [], subtotalMinor: 0, currency: "NGN" });
      return respond({});
    }),
  );
  const script = readFileSync(path.join(process.cwd(), "public/commerce.js"), "utf8");
  // eslint-disable-next-line no-new-func
  new Function(script)();
  document.dispatchEvent(new Event("DOMContentLoaded"));
  await flush();
});

const node = () => document.getElementById("detail")!;
const button = (text: string) => Array.from(node().querySelectorAll("button")).find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
const addButton = () => Array.from(node().querySelectorAll("button")).find((b) => /Add to Cart|Out of Stock|Not available|Added/.test(b.textContent ?? "")) as HTMLButtonElement;

describe("product page with options", () => {
  it("opens on the first in-stock combination, with its price", () => {
    expect(node().textContent).toContain("Size");
    expect(node().textContent).toContain("Colour");
    expect(addButton().textContent).toMatch(/Add to Cart — ₦5,000/);
    expect(node().textContent).not.toContain("Natural food and wellness");
  });

  it("choosing options updates the price, the sale price, the photo, and adds that exact variant", async () => {
    button("M").click();
    expect(addButton().textContent).toMatch(/₦5,500/);
    expect(node().querySelector("s")?.textContent).toMatch(/₦7,000/);
    expect((node().querySelector("img") as HTMLImageElement).getAttribute("src")).toBe("/red-m.png");
    addButton().click();
    await flush();
    expect(posted).toEqual([{ productId: "p1", quantity: 1, variantId: "v-m-red" }]);
  });

  it("a sold-out combination can't be added", () => {
    button("M").click();
    button("Blue").click();
    expect(addButton().textContent).toBe("Out of Stock");
    expect(addButton().disabled).toBe(true);
  });

  it("a combination that doesn't exist says so", () => {
    button("Blue").click(); // S + Blue isn't a variant
    expect(addButton().textContent).toBe("Not available");
    expect(addButton().disabled).toBe(true);
  });

  it("shows customer reviews with the average rating", () => {
    expect(node().textContent).toContain("Customer reviews");
    expect(node().textContent).toContain("4.5 out of 5 · 2 reviews");
    expect(node().textContent).toContain("Lovely fit.");
    expect(node().textContent).toContain("Ada");
  });
});
