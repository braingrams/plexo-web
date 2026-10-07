import { randomUUID } from "node:crypto";
import type { EntityItem } from "electrodb";

import { Template } from "@/lib/db/contentEntities";
import { CommerceCategory, CommerceProduct, CommerceProductReview, CommerceSettings } from "@/lib/db/commerceEntities";
import { WpMigrationJob, WpMigrationPage } from "@/lib/db/importEntities";
import { isKnownCurrency } from "@/lib/commerce/currency";
import { ensureStorefrontLayout, getStorefrontPath } from "@/lib/commerce/storefrontLayout";
import { ensureProductDetailLayout } from "@/lib/commerce/productDetailLayout";
import { rehostMediaUrls } from "@/lib/blogImport/mediaRehostDynamo";
import { slugify } from "@/lib/slugUtils";
import { fetchJson, migrationFetch, restUrl } from "./http";
import { pageKeyForUrl } from "./urlSpace";
import {
  convertWcPage,
  isSkipped,
  mapWcProduct,
  productBaseFromPermalinks,
  type SkippedProduct,
  type WcReview,
  type WcStorePages,
  type WcStoreProduct,
} from "./woocommerce";
import { htmlToText } from "./woocommerce";

// WooCommerce store → Plexo Commerce, as steps of the WordPress migration:
//   planning   planWooCommerce()        list every product (a PRODUCT row each)
//   PRODUCTS   importProductBatch()     create them a few at a time (photos re-hosted)
//              finishProductImport()    reviews, store currency, product URL base
//   PAGES      (runJobDynamo)           shop/cart/checkout/account pages → Plexo widgets
//   →ASSETS    buildStorePresentation() wire those pages up + the product page layout
// See lib/wpMigration/woocommerce.ts for what's read and how it's mapped.

type JobItem = EntityItem<typeof WpMigrationJob>;
type PageItem = EntityItem<typeof WpMigrationPage>;

export interface WcPlanState {
  productBase: string | null;
  currency: string | null;
  storePages?: WcStorePages | null;
  skipped: SkippedProduct[];
  /** Products whose "any size"-style variations were expanded — stock to double-check. */
  expandedStock: string[];
  productsFinished?: boolean;
  storeDone?: boolean;
}

const PRODUCTS_PER_STEP = 8;

/** Lists the store's products as PRODUCT rows. Returns the plan, or null when there's no store. */
export async function planWooCommerce(job: JobItem, restRoot: string): Promise<{ wc: WcPlanState; count: number } | null> {
  const products: WcStoreProduct[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await fetchJson<WcStoreProduct[]>(restUrl(restRoot, "wc/store/v1/products", { per_page: 100, page }));
    if (!res || !Array.isArray(res.data) || res.data.length === 0) break;
    products.push(...res.data);
    if (res.data.length < 100) break;
  }
  if (products.length === 0) return null;
  await Promise.all(
    products.map((p) =>
      WpMigrationPage.put({
        id: randomUUID(),
        jobId: job.id,
        key: `product:${p.id}`,
        kind: "PRODUCT",
        sourceUrl: p.permalink,
        title: p.name,
        wpId: p.id,
        status: "PENDING",
        data: p,
      }).go(),
    ),
  );
  return {
    wc: { productBase: productBaseFromPermalinks(products), currency: products[0]?.prices.currency_code ?? null, skipped: [], expandedStock: [] },
    count: products.length,
  };
}

async function categoryIdFor(job: JobItem, category: { name: string; slug: string } | null, cache: Map<string, string>): Promise<string | undefined> {
  if (!category) return undefined;
  if (cache.has(category.slug)) return cache.get(category.slug);
  const { data: existing } = await CommerceCategory.query.primary({ templateId: job.templateId }).go({ pages: "all" });
  const found = existing.find((c) => c.slug === category.slug || c.name.toLowerCase() === category.name.toLowerCase());
  const id = found?.id ?? randomUUID();
  if (!found) await CommerceCategory.create({ id, templateId: job.templateId, organizationId: job.organizationId, name: category.name, slug: category.slug || slugify(category.name) }).go();
  cache.set(category.slug, id);
  return id;
}

/** Creates the next few products. Returns true when every product row is done. */
export async function importProductBatch(job: JobItem, rows: PageItem[], errors: string[]): Promise<boolean> {
  const wc = (job.planState as { wc?: WcPlanState }).wc!;
  const pending = rows.filter((r) => r.kind === "PRODUCT" && r.status === "PENDING");
  const restRoot = (job.install as { restRoot: string }).restRoot;
  const categoryCache = new Map<string, string>();
  const { data: existingProducts } = await CommerceProduct.query.primary({ templateId: job.templateId }).go({ pages: "all" });
  const slugs = new Set(existingProducts.map((p) => p.slug));

  for (const row of pending.slice(0, PRODUCTS_PER_STEP)) {
    const p = row.data as WcStoreProduct;
    try {
      const variations =
        p.type === "variable"
          ? (await fetchJson<WcStoreProduct[]>(restUrl(restRoot, "wc/store/v1/products", { type: "variation", parent: p.id, per_page: 100 })))?.data ?? []
          : [];
      const mapped = mapWcProduct(p, variations);
      if (isSkipped(mapped)) {
        wc.skipped.push(mapped);
        await WpMigrationPage.patch({ jobId: job.id, key: row.key }).set({ status: "SKIPPED", error: mapped.reason }).go();
        continue;
      }
      // An "any size" variation was expanded into one variant per value (ids wc-<variation>-<n>).
      if (mapped.variants.some((v) => /^wc-\d+-\d+$/.test(v.id) && v.stockQuantity !== null)) {
        wc.expandedStock.push(mapped.name);
      }

      // Photos: product gallery + each variant's own photo, re-hosted on Plexo (product
      // images also show in the dashboard and order emails, off the site's own domain).
      const urls = [...mapped.imageUrls, ...mapped.variants.map((v) => v.imageUrl).filter((u): u is string => Boolean(u))];
      const hosted = await rehostMediaUrls(job.templateId, urls, errors);
      const host = (u: string | null) => (u ? hosted.get(u) ?? u : null);

      // Same slug as on WordPress, so its URL stays the same (the product base + slug).
      let slug = mapped.slug || slugify(mapped.name) || "product";
      if (slugs.has(slug) && !existingProducts.some((e) => e.slug === slug && e.name === mapped.name)) {
        let n = 2;
        while (slugs.has(`${slug}-${n}`)) n++;
        slug = `${slug}-${n}`;
      }
      const already = existingProducts.find((e) => e.slug === slug && e.name === mapped.name);
      const fields = {
        name: mapped.name,
        description: mapped.description || undefined,
        kind: "PHYSICAL" as const,
        priceMinor: mapped.priceMinor,
        ...(mapped.compareAtPriceMinor ? { compareAtPriceMinor: mapped.compareAtPriceMinor } : {}),
        ...(mapped.sku ? { sku: mapped.sku } : {}),
        ...(mapped.stockQuantity !== null && mapped.variants.length === 0 ? { stockQuantity: mapped.stockQuantity } : {}),
        imageUrl: host(mapped.imageUrls[0] ?? null) ?? undefined,
        galleryImageUrls: mapped.imageUrls.slice(1).map((u) => host(u)!),
        categoryId: await categoryIdFor(job, mapped.category, categoryCache),
        ...(mapped.variants.length > 0
          ? { options: mapped.options, variants: mapped.variants.map((v) => ({ ...v, imageUrl: host(v.imageUrl) })) }
          : {}),
        currency: (wc.currency ?? "NGN").toUpperCase(),
        active: true,
      };
      const productId = already?.id ?? randomUUID();
      if (already) await CommerceProduct.patch({ templateId: job.templateId, id: productId }).set(fields).go();
      else await CommerceProduct.create({ id: productId, templateId: job.templateId, organizationId: job.organizationId, slug, ...fields }).go();
      slugs.add(slug);

      await WpMigrationPage.patch({ jobId: job.id, key: row.key })
        .set({ status: "DONE", commerceProductId: productId, newPath: `${wc.productBase ?? "/store"}/${slug}` })
        .go();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`The product "${p.name}" couldn't be moved: ${message}`);
      await WpMigrationPage.patch({ jobId: job.id, key: row.key }).set({ status: "FAILED", error: message }).go();
    }
  }
  return pending.length <= PRODUCTS_PER_STEP;
}

/**
 * Once every product exists: the store's currency and product URLs, Commerce switched on,
 * and the product reviews (with the reviewer's name — WooCommerce never publishes emails).
 */
export async function finishProductImport(job: JobItem, rows: PageItem[], errors: string[]): Promise<void> {
  const wc = (job.planState as { wc?: WcPlanState }).wc!;
  const { data: settings } = await CommerceSettings.get({ templateId: job.templateId }).go();
  const currency = wc.currency && isKnownCurrency(wc.currency) ? wc.currency.toUpperCase() : null;
  if (wc.currency && !currency) errors.push(`Your store priced products in ${wc.currency}, which Plexo Commerce doesn't take payments in yet — prices were kept as numbers; choose your store currency in Commerce → Settings.`);
  const patch = {
    enabled: true,
    ...(currency && !settings?.currency ? { currency } : {}),
    ...(wc.productBase ? { productUrlBase: wc.productBase } : {}),
  };
  if (settings) await CommerceSettings.patch({ templateId: job.templateId }).set(patch).go();
  else await CommerceSettings.create({ id: randomUUID(), templateId: job.templateId, organizationId: job.organizationId, ...patch }).go();

  // Reviews (public): stars, words and the reviewer's name, approved as they were.
  const byWcId = new Map(rows.filter((r) => r.kind === "PRODUCT" && r.commerceProductId).map((r) => [r.wpId, r.commerceProductId!]));
  const restRoot = (job.install as { restRoot: string }).restRoot;
  let imported = 0;
  for (let page = 1; page <= 20; page++) {
    const res = await fetchJson<WcReview[]>(restUrl(restRoot, "wc/store/v1/products/reviews", { per_page: 100, page }));
    if (!res || !Array.isArray(res.data) || res.data.length === 0) break;
    for (const r of res.data) {
      const productId = byWcId.get(r.product_id);
      if (!productId) continue;
      await CommerceProductReview.put({
        id: `wc-${r.id}`,
        templateId: job.templateId,
        organizationId: job.organizationId,
        productId,
        customerEmail: "reviewer@woocommerce-import.invalid",
        customerName: r.reviewer?.slice(0, 120) || "Customer",
        rating: Math.min(5, Math.max(1, Math.round(r.rating || 5))),
        body: htmlToText(r.review ?? "").slice(0, 5000),
        status: "APPROVED",
        ...(r.date_created_gmt ? { createdAt: `${r.date_created_gmt}Z` } : {}),
      }).go().catch(() => undefined);
      imported++;
    }
    if (res.data.length < 100) break;
  }
  wc.productsFinished = true;
  if (imported > 0) (wc as WcPlanState & { reviewsImported?: number }).reviewsImported = imported;
}

/**
 * After the pages are copied: the converted shop/cart/checkout/account pages become the
 * store's pages, the product page layout is made from one of the theme's product pages,
 * anything still missing is created with Plexo's defaults, and old category links point at
 * the shop filtered to that category.
 */
export async function buildStorePresentation(
  job: JobItem,
  pages: PageItem[],
  deps: {
    /** Fetches a WordPress page and runs it through the migration's HTML transform (links, forms, assets queued). */
    fetchTransformed: (url: string, path: string) => Promise<string | null>;
    putRedirect: (fromPath: string, toPath: string) => Promise<void>;
  },
  errors: string[],
): Promise<void> {
  const wc = (job.planState as { wc?: WcPlanState }).wc;
  if (!wc?.productsFinished) return;
  const role = (r: string) => pages.find((p) => p.storeRole === r && p.status === "DONE" && p.templateId)?.templateId;
  const { data: settings } = await CommerceSettings.get({ templateId: job.templateId }).go();

  const wire: Record<string, string> = {};
  const shop = role("shop");
  const checkout = role("checkout") ?? role("cart");
  const account = role("account");
  if (shop && !settings?.storefrontTemplateId) wire.storefrontTemplateId = shop;
  if (checkout && !settings?.storefrontCheckoutTemplateId) wire.storefrontCheckoutTemplateId = checkout;
  if (account && !settings?.trackOrderTemplateId) wire.trackOrderTemplateId = account;

  // Product page: the theme's own single-product page, with its product area swapped for
  // Plexo's product view (pickers, add to cart) — fetched from the first product moved.
  if (!settings?.productDetailTemplateId) {
    const sample = pages.find((p) => p.kind === "PRODUCT" && p.status === "DONE");
    let layout: string | null = null;
    if (sample) {
      const html = await deps.fetchTransformed(sample.sourceUrl, pageKeyForUrl(sample.sourceUrl)).catch(() => null);
      if (html) layout = convertWcPage(html, "product");
    }
    if (layout) {
      const id = randomUUID();
      await Template.create({
        id,
        userId: job.createdBy,
        organizationId: job.organizationId,
        name: "Product page (from WooCommerce)",
        kind: "LANDING_PAGE",
        sourceType: "RAW_UPLOAD",
        isCommerceLayout: true,
        designJson: {},
        compiledHtml: layout,
        migratedFrom: (job.planState as { origin: string }).origin,
      }).go();
      wire.productDetailTemplateId = id;
    }
  }
  if (Object.keys(wire).length > 0) await CommerceSettings.patch({ templateId: job.templateId }).set(wire).go();

  // Anything WooCommerce didn't have a page for gets Plexo's own (order confirmation always).
  await ensureStorefrontLayout(job.templateId, job.organizationId, job.createdBy);
  await ensureProductDetailLayout(job.templateId, job.organizationId, job.createdBy);

  // Old /product-category/<slug>/ links → the shop, filtered to that category.
  const storefront = (await getStorefrontPath(job.templateId)) ?? "/store";
  const terms = await fetchJson<{ slug: string; link?: string }[]>(restUrl((job.install as { restRoot: string }).restRoot, "wc/store/v1/products/categories", { per_page: 100 }));
  for (const t of terms?.data ?? []) {
    const link = (t as { permalink?: string }).permalink ?? t.link;
    if (link) await deps.putRedirect(pageKeyForUrl(link), `${storefront}?category=${encodeURIComponent(t.slug)}`).catch(() => undefined);
  }
  wc.storeDone = true;
  void errors;
}

// ── Private store data, through the Plexo Migrator plugin ───────────────────
// What WooCommerce's public API doesn't show. Read-only on WordPress; on Plexo, imported
// orders are history only — they never move stock, credit the wallet or send emails.

export interface WcPluginProduct {
  id: number;
  manage_stock: boolean;
  stock_quantity: number | null;
  stock_status: string;
  virtual: boolean;
  downloadable: boolean;
  downloads: { id: string; name: string; file: string }[];
  download_limit: number;
  download_expiry: number;
  variations: { id: number; manage_stock: boolean; stock_quantity: number | null; stock_status: string }[];
}

export interface WcPluginCoupon {
  id: number;
  code: string;
  discount_type: string;
  amount: number;
  date_expires: string | null;
  usage_limit: number | null;
  usage_count: number;
  minimum_amount: number;
  maximum_amount: number;
  free_shipping: boolean;
  product_ids: number[];
  product_categories: number[];
  email_restrictions: string[];
  usage_limit_per_user: number | null;
}

export interface WcPluginZone {
  id: number;
  name: string;
  locations: { type: string; code: string; country?: string; state_name?: string }[];
  methods: { type: string; title: string; enabled: boolean; cost: string; min_amount: string; requires: string }[];
}

export interface WcPluginOrder {
  id: number;
  number: string;
  status: string;
  created: string | null;
  currency: string;
  total: number;
  discount_total: number;
  shipping_total: number;
  shipping_method: string;
  payment_method_title: string;
  email: string;
  name: string;
  phone: string;
  country: string;
  state: string;
  state_name?: string;
  address: string;
  note: string;
  items: { name: string; product_id: number; variation_id: number; quantity: number; total: number; sku: string }[];
}

/** Store amounts from WooCommerce (decimal, e.g. 15.5) → Plexo minor units. */
const minorOf = (value: number | string | null | undefined) => Math.round(Number(value || 0) * 100);

/** Plexo product id per WooCommerce product id, from the migration's product rows. */
export function productIdsByWcId(rows: PageItem[]): Map<number, string> {
  return new Map(rows.filter((r) => r.kind === "PRODUCT" && r.commerceProductId && r.wpId).map((r) => [r.wpId!, r.commerceProductId!]));
}

/**
 * Exact stock (per product and per variation) and downloads. A downloadable product
 * becomes a Plexo DIGITAL product: its file is copied privately through the plugin (or
 * linked, when it's hosted elsewhere) with the same download limit/expiry.
 */
export async function applyWcProductExtras(
  job: JobItem,
  products: WcPluginProduct[],
  productIds: Map<number, string>,
  fetchDownload: (productId: number, downloadId: string) => Promise<{ body: Buffer; name: string } | { externalUrl: string } | null>,
  notes: string[],
): Promise<{ stock: number; digital: number }> {
  let stock = 0;
  let digital = 0;
  for (const wp of products) {
    const id = productIds.get(wp.id);
    if (!id) continue;
    const { data: product } = await CommerceProduct.get({ templateId: job.templateId, id }).go();
    if (!product) continue;
    const set: Record<string, unknown> = {};

    const variants = Array.isArray(product.variants) ? (product.variants as { id: string; stockQuantity?: number | null }[]) : [];
    if (variants.length > 0) {
      let changed = false;
      const next = variants.map((v) => {
        const wcVariation = wp.variations.find((x) => v.id === `wc-${x.id}` || v.id.startsWith(`wc-${x.id}-`));
        if (!wcVariation) return v;
        const qty = wcVariation.manage_stock ? Math.max(0, wcVariation.stock_quantity ?? 0) : wcVariation.stock_status === "outofstock" ? 0 : null;
        if (qty === (v.stockQuantity ?? null)) return v;
        changed = true;
        return { ...v, stockQuantity: qty };
      });
      if (changed) {
        set.variants = next;
        stock++;
      }
    } else if (wp.manage_stock && wp.stock_quantity !== null) {
      set.stockQuantity = Math.max(0, wp.stock_quantity);
      stock++;
    }

    if (wp.downloadable && wp.downloads.length > 0) {
      const first = wp.downloads[0];
      const file = await fetchDownload(wp.id, first.id).catch(() => null);
      if (file && "body" in file) {
        const { uploadObject } = await import("@/lib/storage");
        const { url } = await uploadObject(`commerce/${job.templateId}/digital/${id}/${file.name}`, file.body, { access: "private", contentType: "application/octet-stream" });
        Object.assign(set, { kind: "DIGITAL", digitalDeliveryMethod: "FILE_DOWNLOAD", digitalFileUrl: url, digitalFileName: first.name || file.name, digitalFileSizeBytes: file.body.length });
      } else if (file && "externalUrl" in file) {
        Object.assign(set, { kind: "DIGITAL", digitalDeliveryMethod: "EXTERNAL_LINK", digitalExternalUrl: file.externalUrl });
      }
      if (set.kind) {
        if (wp.download_limit > 0) set.digitalMaxDownloads = wp.download_limit;
        if (wp.download_expiry > 0) set.digitalLinkExpiryDays = wp.download_expiry;
        digital++;
        if (wp.downloads.length > 1) notes.push(`“${product.name}” had ${wp.downloads.length} download files — Plexo delivers one per product, so only “${first.name}” moved. Zip them together and upload it in Commerce → Products.`);
      } else {
        notes.push(`“${product.name}” is a download, but its file couldn't be copied — upload it in Commerce → Products.`);
      }
    } else if (wp.virtual && !wp.downloadable) {
      notes.push(`“${product.name}” didn't ship on WooCommerce (a “virtual” product). It's a shipped product on Plexo for now — change how it's delivered in Commerce → Products.`);
    }
    if (Object.keys(set).length > 0) await CommerceProduct.patch({ templateId: job.templateId, id }).set(set).go();
  }
  return { stock, digital };
}

/** Coupons → discount codes. Conditions Plexo doesn't have are named so the owner can check them. */
export async function importWcCoupons(job: JobItem, coupons: WcPluginCoupon[], notes: string[]): Promise<number> {
  const { CommerceDiscountCode } = await import("@/lib/db/commerceEntities");
  let count = 0;
  for (const c of coupons) {
    const code = c.code.trim().toUpperCase();
    if (!code) continue;
    const percent = c.discount_type === "percent";
    const value = percent ? Math.min(100, Math.round(c.amount)) : minorOf(c.amount);
    if (!value) continue;
    const limits: string[] = [];
    if (c.minimum_amount > 0) limits.push(`a minimum spend of ${c.minimum_amount}`);
    if (c.maximum_amount > 0) limits.push(`a maximum spend of ${c.maximum_amount}`);
    if (c.product_ids.length || c.product_categories.length) limits.push("only certain products");
    if (c.email_restrictions.length) limits.push("only certain customers");
    if (c.usage_limit_per_user) limits.push(`${c.usage_limit_per_user} use(s) per customer`);
    if (c.free_shipping) limits.push("free shipping");
    if (c.discount_type === "fixed_product") limits.push("an amount off each product (now off the whole order)");
    if (limits.length) notes.push(`Coupon ${code} had ${limits.join(", ")} on WooCommerce — on Plexo it applies to any order.`);
    await CommerceDiscountCode.put({
      id: `wc-${c.id}`,
      templateId: job.templateId,
      organizationId: job.organizationId,
      code,
      type: percent ? "PERCENT" : "FIXED",
      value,
      active: true,
      ...(c.date_expires ? { expiresAt: new Date(c.date_expires).toISOString() } : {}),
      ...(c.usage_limit ? { usageLimit: c.usage_limit } : {}),
      usedCount: c.usage_count ?? 0,
    }).go();
    count++;
  }
  return count;
}

/** Shipping zones → delivery methods: flat rates and free shipping per area, local pickup. */
export async function importWcShipping(job: JobItem, zones: WcPluginZone[], storeAddress: string, notes: string[]): Promise<number> {
  const { CommerceDeliveryMethod } = await import("@/lib/db/commerceEntities");
  let count = 0;
  let order = 0;
  let pickupMade = false;
  for (const z of zones) {
    const countries = new Set<string>();
    const states = new Set<string>();
    for (const loc of z.locations) {
      if (loc.type === "country") countries.add(loc.code.toUpperCase());
      else if (loc.type === "state" && loc.country) {
        countries.add(loc.country.toUpperCase());
        states.add((loc.state_name ?? loc.code).toUpperCase());
      } else if (loc.type === "postcode" || loc.type === "continent") {
        notes.push(`Shipping zone “${z.name}” used ${loc.type === "postcode" ? "postcodes" : "a continent"} — set the countries/states it covers in Commerce → Delivery.`);
      }
    }
    for (const m of z.methods.filter((x) => x.enabled)) {
      let type: "COURIER" | "PICKUP";
      let feeMinor = 0;
      if (m.type === "local_pickup" || m.type === "pickup_location") {
        if (pickupMade) continue;
        type = "PICKUP";
        pickupMade = true;
      } else if (m.type === "flat_rate") {
        type = "COURIER";
        const cost = Number(m.cost);
        if (Number.isFinite(cost)) feeMinor = minorOf(cost);
        else notes.push(`“${m.title}” worked out its price with a formula (${m.cost}) — set its fee in Commerce → Delivery.`);
      } else if (m.type === "free_shipping") {
        type = "COURIER";
        if (m.requires && m.min_amount) notes.push(`“${m.title}” was free only on orders over ${m.min_amount} — on Plexo it's free on every order in that area.`);
      } else {
        notes.push(`“${m.title}” (a ${m.type} shipping method) needs setting up in Commerce → Delivery.`);
        continue;
      }
      await CommerceDeliveryMethod.put({
        id: `wc-${z.id}-${m.type}-${order}`,
        templateId: job.templateId,
        organizationId: job.organizationId,
        name: m.title || (type === "PICKUP" ? "Pickup" : "Delivery"),
        type,
        feeMinor,
        ...(type === "COURIER" && countries.size ? { countries: Array.from(countries) } : {}),
        ...(type === "COURIER" && states.size ? { states: Array.from(states) } : {}),
        ...(type === "PICKUP" && storeAddress ? { description: storeAddress } : {}),
        status: "ACTIVE",
        sortOrder: order++,
      }).go();
      count++;
    }
  }
  if (count > 0) {
    const { data: settings } = await CommerceSettings.get({ templateId: job.templateId }).go();
    const patch = { deliveryEnabled: true, ...(pickupMade ? { pickupEnabled: true, ...(storeAddress && !settings?.pickupLocation ? { pickupLocation: storeAddress } : {}) } : {}) };
    if (settings) await CommerceSettings.patch({ templateId: job.templateId }).set(patch).go();
  }
  return count;
}

const ORDER_STATUS: Record<string, { status: "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "CANCELLED"; fulfillment: "UNFULFILLED" | "PROCESSING" | "COMPLETED" }> = {
  completed: { status: "PAID", fulfillment: "COMPLETED" },
  processing: { status: "PAID", fulfillment: "PROCESSING" },
  refunded: { status: "REFUNDED", fulfillment: "UNFULFILLED" },
  cancelled: { status: "CANCELLED", fulfillment: "UNFULFILLED" },
  failed: { status: "FAILED", fulfillment: "UNFULFILLED" },
  pending: { status: "PENDING", fulfillment: "UNFULFILLED" },
  "on-hold": { status: "PENDING", fulfillment: "UNFULFILLED" },
};

/** Past orders → Plexo order history (and so its customer list). Idempotent per WooCommerce order. */
export async function importWcOrders(job: JobItem, orders: WcPluginOrder[], productIds: Map<number, string>): Promise<number> {
  const { CommerceOrder, CommerceOrderItem } = await import("@/lib/db/commerceEntities");
  let count = 0;
  for (const o of orders) {
    if (!o.email) continue;
    const id = `wc-order-${o.id}`;
    const mapped = ORDER_STATUS[o.status] ?? { status: "PENDING" as const, fulfillment: "UNFULFILLED" as const };
    try {
      await CommerceOrder.create({
        id,
        templateId: job.templateId,
        organizationId: job.organizationId,
        orderNumber: `WC-${o.number}`,
        customerEmail: o.email.toLowerCase(),
        ...(o.name ? { customerName: o.name } : {}),
        ...(o.phone ? { customerPhone: o.phone } : {}),
        ...(o.country ? { shippingCountry: o.country } : {}),
        ...(o.state_name || o.state ? { shippingState: (o.state_name || o.state).toUpperCase() } : {}),
        ...(o.address ? { shippingAddressLine: o.address } : {}),
        amountMinor: minorOf(o.total),
        discountAmountMinor: minorOf(o.discount_total),
        deliveryFeeMinor: minorOf(o.shipping_total),
        ...(o.shipping_method ? { deliveryMethodNameSnapshot: o.shipping_method } : {}),
        currency: (o.currency || "USD").toUpperCase(),
        status: mapped.status,
        fulfillmentStatus: mapped.fulfillment,
        paymentMethod: "ONLINE",
        metadata: { imported: true, source: "woocommerce", wcOrderId: o.id, paymentMethodTitle: o.payment_method_title, note: o.note || undefined },
        ...(o.created ? { createdAt: new Date(o.created).toISOString() } : {}),
      }).go();
    } catch (err) {
      // Already imported (a re-run) — leave it as it is.
      if ((err as { name?: string; message?: string }).message?.includes("conditional")) continue;
      throw err;
    }
    for (const [i, item] of o.items.entries()) {
      const productId = productIds.get(item.product_id) ?? `wc-product:${item.product_id}`;
      await CommerceOrderItem.create({
        id: `${id}-${i}`,
        templateId: job.templateId,
        orderId: id,
        productId,
        ...(item.variation_id ? { variantId: `wc-${item.variation_id}` } : {}),
        ...(item.sku ? { sku: item.sku } : {}),
        nameSnapshot: item.name,
        unitPriceMinor: item.quantity ? Math.round(minorOf(item.total) / item.quantity) : minorOf(item.total),
        quantity: item.quantity || 1,
      }).go();
    }
    count++;
  }
  return count;
}
