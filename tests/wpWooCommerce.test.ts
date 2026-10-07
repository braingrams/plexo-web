import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import {
  convertWcPage,
  htmlToText,
  isSkipped,
  mapWcProduct,
  productBaseFromPermalinks,
  rewriteWcChrome,
  storePagesFromHtml,
  toPlexoMinor,
  wcPageRole,
  type MappedProduct,
  type WcStoreProduct,
} from "@/lib/wpMigration/woocommerce";
import { normalizeOptionsAndVariants } from "@/lib/commerce/variants";

// Real WooCommerce Store API responses (WooCommerce's own sample store), trimmed.
const fixture = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/woocommerce-store-api.json"), "utf8")) as {
  products: WcStoreProduct[];
  variations: Record<string, WcStoreProduct[]>;
};
const bySlug = (slug: string) => fixture.products.find((p) => p.slug === slug)!;
const mapped = (slug: string) => {
  const p = bySlug(slug);
  return mapWcProduct(p, fixture.variations[String(p.id)] ?? []) as MappedProduct;
};

describe("mapWcProduct", () => {
  it("a simple product on sale keeps its price, 'was' price, SKU, photo and category", () => {
    const beanie = mapped("beanie");
    expect(beanie).toMatchObject({ name: "Beanie", priceMinor: 1800, compareAtPriceMinor: 2000, sku: "woo-beanie", category: { slug: "accessories" } });
    expect(beanie.imageUrls[0]).toMatch(/beanie/);
    expect(beanie.variants).toEqual([]);
  });

  it("a variable product's variation attributes become options, each variation its own priced variant", () => {
    const hoodie = mapped("hoodie");
    expect(hoodie.options).toEqual([
      { name: "Color", values: ["Blue", "Green", "Red"] },
      { name: "Logo", values: ["Yes", "No"] },
    ]);
    expect(hoodie.variants).toHaveLength(4); // only the combinations WooCommerce actually sells
    const red = hoodie.variants.find((v) => v.options.Color === "Red")!;
    expect(red).toMatchObject({ id: "wc-34", options: { Color: "Red", Logo: "No" }, priceMinor: 4200, compareAtPriceMinor: 4500, sku: "woo-hoodie-red" });
    expect(hoodie.priceMinor).toBe(4200); // the product's price follows its cheapest variant
  });

  it("a variation sold in 'any' size becomes one variant per size, at that variation's price", () => {
    const vneck = mapped("v-neck-t-shirt");
    const green = vneck.variants.filter((v) => v.options.Color === "Green");
    expect(green.map((v) => v.options.Size).sort()).toEqual(["Large", "Medium", "Small"]);
    expect(new Set(green.map((v) => v.priceMinor))).toEqual(new Set([2000]));
  });

  it("produces variants Plexo's own validation accepts", () => {
    for (const slug of ["hoodie", "v-neck-t-shirt"]) {
      const m = mapped(slug);
      expect(() => normalizeOptionsAndVariants(m.options, m.variants)).not.toThrow();
    }
  });

  it("explains what can't be moved as a product", () => {
    const pennant = mapWcProduct(bySlug("wordpress-pennant"));
    const collection = mapWcProduct(bySlug("logo-collection"));
    expect(isSkipped(pennant) && pennant.reason).toMatch(/sold on another website/);
    expect(isSkipped(collection) && collection.reason).toMatch(/each product in it was moved/);
  });
});

describe("helpers", () => {
  it("currency minor units → Plexo's 2-decimal minor units", () => {
    expect(toPlexoMinor("1800", 2)).toBe(1800);
    expect(toPlexoMinor("500", 0)).toBe(50000); // e.g. a zero-decimal currency
    expect(toPlexoMinor("", 2)).toBeNull();
  });

  it("product descriptions read as text", () => {
    expect(htmlToText("<p>Soft &amp; warm.</p><ul><li>Cotton</li><li>Wool</li></ul>")).toBe("Soft & warm.\n• Cotton\n• Wool");
  });

  it("finds the product URL base every permalink shares", () => {
    expect(productBaseFromPermalinks(fixture.products)).toBe("/product");
    expect(productBaseFromPermalinks([{ slug: "tee", permalink: "https://x.org/lineagecare/shop/item/tee/" }])).toBe("/lineagecare/shop/item");
  });
});

describe("store pages", () => {
  const snippet =
    "wcSettings=JSON.parse(decodeURIComponent('%7B%22storePages%22%3A%7B%22myaccount%22%3A%7B%22id%22%3A15%2C%22permalink%22%3A%22https%3A%5C%2F%5C%2Fshop.example%5C%2Fmy-account%5C%2F%22%7D%2C%22shop%22%3A%7B%22id%22%3A12%2C%22permalink%22%3A%22https%3A%5C%2F%5C%2Fshop.example%5C%2Fshop%5C%2F%22%7D%2C%22cart%22%3A%7B%22id%22%3A13%2C%22permalink%22%3A%22https%3A%5C%2F%5C%2Fshop.example%5C%2Fcart%5C%2F%22%7D%2C%22checkout%22%3A%7B%22id%22%3A14%2C%22permalink%22%3A%22https%3A%5C%2F%5C%2Fshop.example%5C%2Fcheckout%5C%2F%22%7D%2C%22terms%22%3A%7B%22id%22%3A0%2C%22permalink%22%3Afalse%7D%7D%2C%22wcVersion%22%3A%2211.1.2%22%7D'))";

  it("reads WooCommerce's own page map (URL-encoded in its scripts)", () => {
    expect(storePagesFromHtml(snippet)).toEqual({
      myaccount: "https://shop.example/my-account/",
      shop: "https://shop.example/shop/",
      cart: "https://shop.example/cart/",
      checkout: "https://shop.example/checkout/",
    });
  });

  it("knows the checkout page even though WooCommerce redirected it to the cart (empty cart)", () => {
    const map = storePagesFromHtml(snippet);
    expect(wcPageRole('<body class="woocommerce-cart">', "https://shop.example/checkout/", map)).toBe("checkout");
    expect(wcPageRole('<body class="woocommerce-cart">', "https://shop.example/cart/", map)).toBe("cart");
    expect(wcPageRole('<body class="woocommerce-shop">', "https://shop.example/some-page/", null)).toBe("shop");
    expect(wcPageRole('<body class="home page">', "https://shop.example/", map)).toBeNull();
  });

  it("classic shop: the product list becomes Plexo's shop grid; WooCommerce's sort/count/paging go", () => {
    const html = `<body><header>H</header><main><h1>Shop</h1><p class="woocommerce-result-count">Showing 1–16</p><form class="woocommerce-ordering"></form>
      <ul class="products"><li class="product"><a href="/product/beanie/">Beanie</a></li></ul><nav class="woocommerce-pagination"></nav></main><footer>F</footer></body>`;
    const out = convertWcPage(html, "shop")!;
    expect(out).toMatch(/data-plexo-commerce-shopgrid="true"/i);
    expect(out).not.toContain("woocommerce-result-count");
    expect(out).not.toContain("woocommerce-pagination");
    expect(out).toContain("<h1>Shop</h1>");
    expect(out).toContain("<header>H</header>");
  });

  it("block-theme product page: its main area becomes Plexo's product view, header and footer stay", () => {
    const html = `<body><header class="wp-block-template-part">Logo</header><main><div class="wp-block-woocommerce-product-image-gallery"></div><form class="cart"></form></main><footer class="wp-block-template-part">Footer</footer></body>`;
    const out = convertWcPage(html, "product")!;
    expect(out).toMatch(/data-plexo-commerce-product="true" data-plexo-commerce-mode="detail"/i);
    expect(out).toContain("Logo");
    expect(out).toContain("Footer");
    expect(out).not.toContain("form class=\"cart\"");
  });

  it("cart, checkout and account pages get Plexo's cart, checkout and order tracking", () => {
    const page = (inner: string) => `<body><main><h1>Title</h1><div class="woocommerce">${inner}</div></main></body>`;
    expect(convertWcPage(page("cart"), "cart")).toMatch(/data-plexo-commerce-cartsummary/i);
    const checkout = convertWcPage(page("checkout"), "checkout")!;
    expect(checkout).toMatch(/data-plexo-commerce-cartsummary/i);
    expect(checkout).toMatch(/data-plexo-commerce-checkoutflow/i);
    expect(convertWcPage(page("login"), "account")).toMatch(/data-plexo-commerce-ordertracking/i);
  });

  it("header cart icon shows Plexo's live cart; list 'Add to cart' buttons open the product", () => {
    const $ = cheerio.load(`<header><a class="cart-contents" href="/cart/"><span class="cart-contents-count">3</span></a></header>
      <ul class="products"><li class="product"><a class="woocommerce-LoopProduct-link" href="/product/cap/">Cap</a><a href="?add-to-cart=23" data-product_id="23" class="add_to_cart_button ajax_add_to_cart">Add to cart</a></li></ul>`);
    rewriteWcChrome($, "/basket");
    expect($(".cart-contents-count").attr("data-plexo-cart-count")).toBe("");
    expect($("a.cart-contents").attr("href")).toBe("/basket");
    const button = $("a.add_to_cart_button");
    expect(button.attr("href")).toBe("/product/cap/");
    expect(button.hasClass("ajax_add_to_cart")).toBe(false);
  });
});

describe("plugin namespaces", () => {
  it("WooCommerce's and GiveWP's many API namespaces are each one known plugin; Plexo's own helper is recognised", async () => {
    const { pluginSlugForNamespace } = await import("@/lib/wpMigration/pluginCatalog");
    for (const ns of ["wc/v1", "wc/v3", "wc/store/v1", "wc-admin", "wc-analytics", "wc-telemetry", "wc-admin-email", "wccom-site/v3", "woocommerce/v1"]) {
      expect(pluginSlugForNamespace(ns)).toBe("woocommerce");
    }
    for (const ns of ["give-api/v2", "givewp/v3", "give/v1"]) expect(pluginSlugForNamespace(ns)).toBe("give");
    expect(pluginSlugForNamespace("plexo-migrator/v1")).toBe("plexo-migrator");
    expect(pluginSlugForNamespace("lceap/v1")).toBe("lceap"); // a site's own custom plugin is still flagged
  });
});
