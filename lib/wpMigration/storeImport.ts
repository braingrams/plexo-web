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
      if (p.type === "variable" && variations.some((v) => v.variations?.length === 0) && mapped.variants.some((v) => /-\d+$/.test(v.id) && v.stockQuantity !== null)) {
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
