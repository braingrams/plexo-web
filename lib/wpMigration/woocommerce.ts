import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

import { fetchJson, restUrl } from "./http";
import { decodeEntities } from "./inventory";
import type { WpInstall } from "./types";

// WooCommerce → Plexo Commerce. The catalogue comes from WooCommerce's PUBLIC Store API
// (wc/store/v1 — what its own block checkout uses), so no login or plugin is needed:
// products, variations, prices and sale prices, SKUs, photos, categories and reviews. The
// store's pages (shop, cart, checkout, my account, single product) keep the WordPress
// theme, with WooCommerce's parts swapped for Plexo Commerce's working widgets — and
// products keep their exact URLs (CommerceSettings.productUrlBase). What the Store API
// doesn't expose (exact stock counts, downloads, coupons, shipping, past orders) comes
// through the Plexo Migrator plugin.

// ── Store API shapes (the subset used) ─────────────────────────────────────

export interface WcPrices {
  price: string;
  regular_price: string;
  sale_price: string;
  currency_code: string;
  currency_minor_unit: number;
}

export interface WcStoreProduct {
  id: number;
  name: string;
  slug: string;
  parent?: number;
  type: "simple" | "variable" | "grouped" | "external" | "variation" | string;
  permalink: string;
  sku: string;
  description: string;
  short_description: string;
  prices: WcPrices;
  images: { src: string; alt?: string }[];
  categories: { id: number; name: string; slug: string }[];
  attributes: { id: number; name: string; taxonomy: string | null; has_variations: boolean; terms: { id: number; name: string; slug: string }[] }[];
  variations: { id: number; attributes: { name: string; value: string }[] }[];
  is_in_stock: boolean;
  low_stock_remaining: number | null;
  is_purchasable?: boolean;
  add_to_cart?: { url?: string };
}

export interface WcReview {
  id: number;
  product_id: number;
  reviewer: string;
  review: string;
  rating: number;
  verified?: boolean;
  date_created_gmt?: string;
}

export interface WcCatalog {
  currency: string | null;
  products: WcStoreProduct[];
  /** Variable product id → its variations (each a full product with its own prices/stock/SKU). */
  variations: Map<number, WcStoreProduct[]>;
  categories: { id: number; name: string; slug: string; parent: number }[];
  reviews: WcReview[];
}

export function isWooCommerce(install: Pick<WpInstall, "namespaces">): boolean {
  return install.namespaces.some((n) => n === "wc/store/v1" || n === "wc/store");
}

async function fetchAllPages<T>(restRoot: string, route: string, params: Record<string, string | number> = {}, maxPages = 50): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchJson<T[]>(restUrl(restRoot, route, { ...params, per_page: 100, page }));
    if (!res || !Array.isArray(res.data) || res.data.length === 0) break;
    out.push(...res.data);
    const totalPages = Number(res.headers.get("x-wp-totalpages") ?? "0");
    if (res.data.length < 100 || (totalPages && page >= totalPages)) break;
  }
  return out;
}

/** The whole public catalogue. Store-wide limit: 5,000 products (50 pages of 100). */
export async function fetchWcCatalog(restRoot: string): Promise<WcCatalog> {
  const [products, categories, reviews] = await Promise.all([
    fetchAllPages<WcStoreProduct>(restRoot, "wc/store/v1/products"),
    fetchAllPages<WcCatalog["categories"][number]>(restRoot, "wc/store/v1/products/categories", {}, 10),
    fetchAllPages<WcReview>(restRoot, "wc/store/v1/products/reviews", {}, 20).catch(() => []),
  ]);
  const variations = new Map<number, WcStoreProduct[]>();
  for (const p of products.filter((x) => x.type === "variable")) {
    variations.set(p.id, await fetchAllPages<WcStoreProduct>(restRoot, "wc/store/v1/products", { type: "variation", parent: p.id }, 5));
  }
  return { currency: products[0]?.prices.currency_code ?? null, products, variations, categories, reviews };
}

// ── Mapping ─────────────────────────────────────────────────────────────────

/** WooCommerce minor units (per the store's currency settings) → Plexo's (2 decimals). */
export function toPlexoMinor(value: string | number | null | undefined, minorUnit: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10 ** (2 - minorUnit));
}

/** Product description HTML → readable plain text (Plexo shows descriptions as text). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*(\n\s*)+/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

function titleCase(s: string): string {
  return s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function stockOf(p: Pick<WcStoreProduct, "is_in_stock" | "low_stock_remaining">): number | null {
  if (!p.is_in_stock) return 0;
  return typeof p.low_stock_remaining === "number" ? p.low_stock_remaining : null;
}

export interface MappedVariant {
  id: string;
  options: Record<string, string>;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  sku: string | null;
  stockQuantity: number | null;
  imageUrl: string | null;
  active: boolean;
}

export interface MappedProduct {
  wcId: number;
  name: string;
  slug: string;
  description: string;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  sku: string | null;
  stockQuantity: number | null;
  /** Main image first, then the gallery (WooCommerce URLs — rehosted by the caller). */
  imageUrls: string[];
  imageAlt: string | null;
  category: { name: string; slug: string } | null;
  options: { name: string; values: string[] }[];
  variants: MappedVariant[];
}

export interface SkippedProduct {
  wcId: number;
  name: string;
  type: string;
  reason: string;
  url: string | null;
}

/** One WooCommerce product → a Plexo product, or why it can't be moved as one. */
export function mapWcProduct(p: WcStoreProduct, variations: WcStoreProduct[] = []): MappedProduct | SkippedProduct {
  const name = decodeEntities(p.name);
  if (p.type === "external") {
    return { wcId: p.id, name, type: "external", url: p.add_to_cart?.url ?? null, reason: "sold on another website (an affiliate/external link) — Plexo products are bought on your own site" };
  }
  if (p.type === "grouped") {
    return { wcId: p.id, name, type: "grouped", url: p.permalink, reason: "a group page of other products — each product in it was moved on its own" };
  }
  if (p.type !== "simple" && p.type !== "variable") {
    return { wcId: p.id, name, type: p.type, url: p.permalink, reason: `a WooCommerce "${p.type}" product, which needs the plugin that created it` };
  }
  const minor = p.prices.currency_minor_unit ?? 2;
  const base = {
    wcId: p.id,
    name,
    slug: p.slug,
    description: htmlToText(p.description || p.short_description || ""),
    sku: p.sku || null,
    imageUrls: p.images.map((i) => i.src).filter(Boolean),
    imageAlt: p.images[0]?.alt || null,
    category: p.categories[0] ? { name: decodeEntities(p.categories[0].name), slug: p.categories[0].slug } : null,
  };

  if (p.type === "simple" || variations.length === 0) {
    const price = toPlexoMinor(p.prices.price, minor) ?? 0;
    const regular = toPlexoMinor(p.prices.regular_price, minor);
    return {
      ...base,
      priceMinor: price,
      compareAtPriceMinor: regular !== null && regular > price ? regular : null,
      stockQuantity: stockOf(p),
      options: [],
      variants: [],
    };
  }

  // Variable product: attributes used for variations become options. A taxonomy attribute
  // ("pa_color") lists its values as slugs in each variation — shown by their term names.
  const optionAttrs = p.attributes.filter((a) => a.has_variations && a.terms.length > 0);
  const options = optionAttrs.map((a) => ({ name: titleCase(decodeEntities(a.name)), values: a.terms.map((t) => decodeEntities(t.name)) }));
  const valueName = (attrName: string, value: string): string | null => {
    const attr = optionAttrs.find((a) => a.name.toLowerCase() === attrName.toLowerCase() || a.taxonomy === attrName || `pa_${a.name.toLowerCase()}` === attrName.toLowerCase());
    if (!attr) return null;
    const term = attr.terms.find((t) => t.slug.toLowerCase() === value.toLowerCase() || t.name.toLowerCase() === value.toLowerCase());
    return term ? decodeEntities(term.name) : null;
  };

  const variants: MappedVariant[] = [];
  const seen = new Set<string>();
  for (const v of variations) {
    const ref = p.variations.find((x) => x.id === v.id);
    const attrs = ref?.attributes ?? [];
    // A blank value means "any" — the one variation is sold in every value of that option.
    let combos: Record<string, string>[] = [{}];
    optionAttrs.forEach((a, i) => {
      const set = attrs.find((x) => x.name.toLowerCase() === a.name.toLowerCase() || x.name === a.taxonomy);
      const chosen = set?.value ? valueName(set.name, set.value) : null;
      const values = chosen ? [chosen] : options[i].values;
      combos = combos.flatMap((c) => values.map((val) => ({ ...c, [options[i].name]: val })));
    });
    const vMinor = v.prices.currency_minor_unit ?? minor;
    const price = toPlexoMinor(v.prices.price, vMinor) ?? 0;
    const regular = toPlexoMinor(v.prices.regular_price, vMinor);
    combos.forEach((combo, k) => {
      const key = options.map((o) => combo[o.name]).join("\u0000");
      if (seen.has(key)) return;
      seen.add(key);
      variants.push({
        id: combos.length === 1 ? `wc-${v.id}` : `wc-${v.id}-${k}`,
        options: combo,
        priceMinor: price,
        compareAtPriceMinor: regular !== null && regular > price ? regular : null,
        sku: v.sku || null,
        stockQuantity: stockOf(v),
        imageUrl: v.images[0]?.src ?? null,
        active: v.is_purchasable !== false,
      });
    });
  }
  const prices = variants.filter((v) => v.active).map((v) => v.priceMinor);
  return {
    ...base,
    priceMinor: prices.length ? Math.min(...prices) : toPlexoMinor(p.prices.price, minor) ?? 0,
    compareAtPriceMinor: null,
    stockQuantity: null,
    options,
    variants: variants.slice(0, 100),
  };
}

export function isSkipped(m: MappedProduct | SkippedProduct): m is SkippedProduct {
  return "reason" in m;
}

/** "/product" (or "/shop/item", "/lineagecare/product") — what every product permalink shares before its slug. */
export function productBaseFromPermalinks(products: Pick<WcStoreProduct, "permalink" | "slug">[]): string | null {
  const bases = new Map<string, number>();
  for (const p of products) {
    try {
      const path = decodeURIComponent(new URL(p.permalink).pathname).replace(/\/+$/, "");
      if (!path.endsWith(`/${p.slug}`)) continue;
      const base = path.slice(0, -(p.slug.length + 1));
      if (base) bases.set(base, (bases.get(base) ?? 0) + 1);
    } catch {
      // ignore
    }
  }
  const best = Array.from(bases).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

// ── Store pages ─────────────────────────────────────────────────────────────

export type WcPageRole = "shop" | "cart" | "checkout" | "account" | "product";

export interface WcStorePages {
  shop?: string;
  cart?: string;
  checkout?: string;
  myaccount?: string;
}

/** WooCommerce's own map of its store pages, embedded in its scripts (plain or URL-encoded JSON). */
export function storePagesFromHtml(rawHtml: string): WcStorePages | null {
  const candidates = [rawHtml];
  const encoded = rawHtml.match(/%22storePages%22%3A%7B[\s\S]{0,4000}?%7D%7D/);
  if (encoded) {
    try {
      candidates.push(decodeURIComponent(encoded[0]));
    } catch {
      // ignore
    }
  }
  for (const text of candidates) {
    const m = /"storePages"\s*:\s*(\{[\s\S]*?\}\s*\})\s*(?:[,}]|$)/.exec(text.replace(/\\\//g, "/"));
    if (!m) continue;
    const pages: WcStorePages = {};
    for (const key of ["shop", "cart", "checkout", "myaccount"] as const) {
      const k = new RegExp(`"${key}"\\s*:\\s*\\{[^}]*?"permalink"\\s*:\\s*"([^"]+)"`).exec(m[1]);
      if (k) pages[key] = k[1];
    }
    if (Object.keys(pages).length > 0) return pages;
  }
  return null;
}

/** What a migrated page is in the store, from WooCommerce's page map, then <body class>. */
export function wcPageRole(rawHtml: string, pageUrl: string, storePages: WcStorePages | null): WcPageRole | null {
  const norm = (u: string) => {
    try {
      return new URL(u).pathname.replace(/\/+$/, "") || "/";
    } catch {
      return u.replace(/\/+$/, "") || "/";
    }
  };
  const here = norm(pageUrl);
  if (storePages) {
    if (storePages.checkout && norm(storePages.checkout) === here) return "checkout";
    if (storePages.cart && norm(storePages.cart) === here) return "cart";
    if (storePages.myaccount && norm(storePages.myaccount) === here) return "account";
    if (storePages.shop && norm(storePages.shop) === here) return "shop";
  }
  const body = /<body\b[^>]*\bclass\s*=\s*["']([^"']*)["']/i.exec(rawHtml)?.[1] ?? "";
  const classes = new Set(body.split(/\s+/));
  // The checkout page redirects to the cart when the visitor's cart is empty (the migrator's
  // always is), so its own body class is rarely seen — the page map above is what finds it.
  if (classes.has("woocommerce-checkout")) return "checkout";
  if (classes.has("woocommerce-cart")) return "cart";
  if (classes.has("woocommerce-account")) return "account";
  if (classes.has("woocommerce-shop") || classes.has("post-type-archive-product")) return "shop";
  if (classes.has("single-product")) return "product";
  return null;
}

const COMMERCE_MARKERS: Record<Exclude<WcPageRole, "product">, string> = {
  shop: '<div data-plexo-commerce-shopGrid="true" data-plexo-commerce-store-mode="true"></div>',
  cart: '<div data-plexo-commerce-cartSummary="true"></div>',
  checkout: '<div data-plexo-commerce-cartSummary="true"></div><div data-plexo-commerce-checkoutFlow="true"></div>',
  account: '<div data-plexo-commerce-orderTracking="true"></div>',
};

// Where WooCommerce draws the store itself, most specific first.
const STORE_AREAS: Record<WcPageRole, string[]> = {
  shop: [
    ".elementor-widget-wc-archive-products",
    ".elementor-widget-woocommerce-products",
    ".wp-block-woocommerce-product-collection",
    ".wp-block-woocommerce-product-catalog",
    "ul.products",
  ],
  cart: [".wp-block-woocommerce-cart", ".elementor-widget-woocommerce-cart", "div.woocommerce:not(.wc-block-store-notices)"],
  // With an empty cart WooCommerce serves the CART at the checkout address — either one is
  // what gets replaced (by Plexo's cart + checkout).
  checkout: [
    ".wp-block-woocommerce-checkout",
    ".wp-block-woocommerce-cart",
    ".elementor-widget-woocommerce-checkout-page",
    ".elementor-widget-woocommerce-cart",
    "div.woocommerce:not(.wc-block-store-notices)",
  ],
  account: [".elementor-widget-woocommerce-my-account", "div.woocommerce:not(.wc-block-store-notices)", ".wp-block-woocommerce-customer-account"],
  product: ['[data-elementor-type="product"]', "div.type-product", "div.product"],
};
// WooCommerce chrome around the product list that Plexo's shop grid replaces (its own search/sort/paging).
const SHOP_LEFTOVERS = ".woocommerce-result-count, .woocommerce-ordering, .woocommerce-pagination, .wp-block-woocommerce-product-results-count, .wp-block-woocommerce-catalog-sorting, .wp-block-query-pagination, .woocommerce-products-header__title.page-title + .term-description";

function firstMatch($: CheerioAPI, selectors: string[]): Cheerio<Element> | null {
  for (const s of selectors) {
    const el = $(s).first();
    if (el.length > 0) return el as Cheerio<Element>;
  }
  return null;
}

/**
 * A WooCommerce store page, keeping the theme around it, with its store part replaced by
 * Plexo Commerce's widget. null when the store part can't be found (the caller then uses a
 * fallback layout).
 */
export function convertWcPage(html: string, role: WcPageRole): string | null {
  const $ = cheerio.load(html);
  let area = firstMatch($, STORE_AREAS[role]);
  // Block themes: the template's <main> holds the product/store; header and footer are outside it.
  if (!area && (role === "product" || role === "shop")) area = $("main").first().length ? ($("main").first() as Cheerio<Element>) : null;
  if (!area) return null;
  if (role === "shop") $(SHOP_LEFTOVERS).remove();
  // WooCommerce's own notice banners ("added to cart", errors) mean nothing on Plexo.
  $(".wc-block-store-notices, .woocommerce-notices-wrapper").remove();
  const marker = role === "product" ? '<div data-plexo-commerce-product="true" data-plexo-commerce-mode="detail"></div>' : COMMERCE_MARKERS[role];
  // A WooCommerce block is replaced outright: its scripts re-render anything still carrying
  // its class (which would wipe Plexo's widget). Other wrappers keep their spacing/styling.
  if (role === "product" || role === "shop" || /\bwp-block-woocommerce-/.test(area.attr("class") ?? "")) area.replaceWith(marker);
  else area.html(marker);
  rewriteWcChrome($);
  return $.html();
}

/**
 * Store bits outside the store pages, on every migrated page: the header's cart icon shows
 * Plexo's live cart count and opens the cart; "Add to cart" buttons in a product list (they
 * added to the WooCommerce cart) open the product's page instead. Runs on the parsed page.
 */
export function rewriteWcChrome($: CheerioAPI, cartPath?: string): void {
  $(".cart-contents-count, .elementor-button-icon-qty, .wc-block-mini-cart__badge, .count.cart-count, .cart-count").each((_, el) => {
    $(el).attr("data-plexo-cart-count", "").text("0").attr("style", "display:none");
  });
  if (cartPath) {
    $("a.cart-contents, .elementor-menu-cart__toggle a, a.wc-block-mini-cart__button").attr("href", cartPath);
  }
  $("a.add_to_cart_button, a.ajax_add_to_cart").each((_, a) => {
    const product = $(a).closest("li.product, .wc-block-product, .product, .wp-block-post");
    const link = product.find("a.woocommerce-LoopProduct-link, a.woocommerce-loop-product__link, h2 a, h3 a, a[href]").not(a).first().attr("href");
    if (link) $(a).attr("href", link).removeClass("ajax_add_to_cart").removeAttr("data-product_id");
  });
}

/** True if this page has anything WooCommerce draws (so it's worth parsing). */
export function hasWcChrome(html: string): boolean {
  return /cart-contents|elementor-menu-cart|wc-block-mini-cart|add_to_cart_button/.test(html);
}
