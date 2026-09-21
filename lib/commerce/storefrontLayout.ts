import { randomUUID } from "node:crypto";
import { compileToHTML } from "@/lib/compiler";
import { sanitizeHtml } from "@/server/sanitizer";
import { getEnabledSiteLayoutRows, spliceLayoutRows } from "@/lib/siteLayoutCore";
import { ensureUniqueSlug } from "@/server/slugDynamo";
import { Template } from "@/lib/db/contentEntities";
import { CommerceSettings } from "@/lib/db/commerceEntities";

/**
 * The four "system" pages a working storefront needs, auto-provisioned the moment Commerce
 * is enabled — same rationale as productDetailLayout.ts's PRODUCT_DETAIL_STARTER_DESIGN_JSON,
 * extended to the rest of the buying flow: a site owner should never have to know that a
 * `shop_grid` marker needs a page, or that Paystack/Stripe's payment redirect and the "Track
 * my order" link both expect fixed paths to already exist.
 *
 * Unlike the product-detail layout (a parentId-less fragment shared by every product), these
 * are real page-tree Templates (parentId + slug), because each is a single fixed page, not one
 * shared across many items — findChildBySlug in app/pub/[domain]/[[...slug]]/route.ts already
 * resolves any such Template with no changes needed there.
 *
 * Deliberately created via Template.create directly rather than the create_landing_page_subpage
 * MCP tool/route, which gates multi-page sites behind an Ultra subscription plan
 * (getTierFeatures(...).multiPageSitesEnabled) — that gate is for a user's own deliberate
 * multi-page site, not for infrastructure a paid Commerce feature already requires to function.
 */
function headingRow(text: string): any {
  return {
    id: `row-${randomUUID()}`,
    style: { padding: "48px 24px 8px" },
    columns: [
      {
        id: `col-${randomUUID()}`,
        width: "100%",
        styles: {},
        elements: [
          {
            id: `el-${randomUUID()}`,
            type: "heading",
            style: { fontSize: "32px", fontWeight: "800", textAlign: "center" },
            attributes: { text },
          },
        ],
      },
    ],
  };
}

function markerRow(type: string, attributes: Record<string, unknown> = {}, minHeight = "400px"): any {
  return {
    id: `row-${randomUUID()}`,
    style: { padding: "16px 24px 48px" },
    columns: [
      {
        id: `col-${randomUUID()}`,
        width: "100%",
        styles: {},
        elements: [
          {
            id: `el-${randomUUID()}`,
            type,
            style: { width: "100%", minHeight },
            attributes,
          },
        ],
      },
    ],
  };
}

export function buildStorefrontDesignJson(): any {
  return { body: { style: { background: "#ffffff", fontFamily: "inherit" }, rows: [headingRow("Shop"), markerRow("shop_grid", {}, "700px")] } };
}

export function buildCheckoutDesignJson(): any {
  return {
    body: {
      style: { background: "#ffffff", fontFamily: "inherit" },
      rows: [headingRow("Your Cart"), markerRow("cart_summary", {}, "300px"), markerRow("checkout_flow", {}, "500px")],
    },
  };
}

export function buildOrderConfirmationDesignJson(): any {
  return { body: { style: { background: "#ffffff", fontFamily: "inherit" }, rows: [markerRow("order_confirmation", {}, "500px")] } };
}

export function buildTrackOrderDesignJson(): any {
  return { body: { style: { background: "#ffffff", fontFamily: "inherit" }, rows: [headingRow("Track Your Order"), markerRow("order_tracking", {}, "400px")] } };
}

async function compileForSite(rootTemplateId: string, designJson: any): Promise<string> {
  const layout = await getEnabledSiteLayoutRows(rootTemplateId);
  const spliced = spliceLayoutRows(designJson, layout);
  return sanitizeHtml(compileToHTML(spliced));
}

async function findChildBySlug(parentId: string, slug: string): Promise<{ id: string } | null> {
  const { data: siblings } = await Template.query.byParent({ parentId }).go();
  return siblings.find((s) => s.slug === slug) ?? null;
}

async function nextOrder(parentId: string): Promise<number> {
  const { data: siblings } = await Template.query.byParent({ parentId }).go();
  return siblings.reduce((max, s) => Math.max(max, s.order ?? 0), -1) + 1;
}

async function createChildPage(params: {
  parentId: string;
  rootId: string;
  userId: string;
  organizationId: string;
  name: string;
  slug: string;
  designJson: any;
}): Promise<string> {
  const id = randomUUID();
  const compiledHtml = await compileForSite(params.rootId, params.designJson);
  const order = await nextOrder(params.parentId);
  await Template.create({
    id,
    userId: params.userId,
    organizationId: params.organizationId,
    name: params.name,
    kind: "LANDING_PAGE",
    sourceType: "BUILDER",
    parentId: params.parentId,
    slug: params.slug,
    order,
    designJson: params.designJson,
    compiledHtml,
  }).go();
  return id;
}

export const DEFAULT_STOREFRONT_SLUG = "store";

/**
 * Idempotent: for each of the 4 pages, skips creation if CommerceSettings already points at
 * one, or a page already exists at that slug (respects a site owner's own manual page). Safe
 * to call from every path that might be the first one to enable Commerce (the settings PUT
 * route, MCP's update_commerce_settings) — same convention as ensureProductDetailLayout.
 */
export async function ensureStorefrontLayout(templateId: string, organizationId: string, userId: string): Promise<void> {
  const { data: settings } = await CommerceSettings.get({ templateId }).go();

  let storefrontTemplateId = settings?.storefrontTemplateId ?? null;
  if (!storefrontTemplateId) {
    const existing = await findChildBySlug(templateId, DEFAULT_STOREFRONT_SLUG);
    storefrontTemplateId = existing
      ? existing.id
      : await createChildPage({
          parentId: templateId,
          rootId: templateId,
          userId,
          organizationId,
          name: "Shop",
          slug: DEFAULT_STOREFRONT_SLUG,
          designJson: buildStorefrontDesignJson(),
        });
  }

  let storefrontCheckoutTemplateId = settings?.storefrontCheckoutTemplateId ?? null;
  if (!storefrontCheckoutTemplateId) {
    const existing = await findChildBySlug(storefrontTemplateId, "checkout");
    storefrontCheckoutTemplateId = existing
      ? existing.id
      : await createChildPage({
          parentId: storefrontTemplateId,
          rootId: templateId,
          userId,
          organizationId,
          name: "Checkout",
          slug: "checkout",
          designJson: buildCheckoutDesignJson(),
        });
  }

  let orderConfirmationTemplateId = settings?.orderConfirmationTemplateId ?? null;
  if (!orderConfirmationTemplateId) {
    const existing = await findChildBySlug(templateId, "order-confirmation");
    orderConfirmationTemplateId = existing
      ? existing.id
      : await createChildPage({
          parentId: templateId,
          rootId: templateId,
          userId,
          organizationId,
          name: "Order Confirmation",
          slug: "order-confirmation",
          designJson: buildOrderConfirmationDesignJson(),
        });
  }

  let trackOrderTemplateId = settings?.trackOrderTemplateId ?? null;
  if (!trackOrderTemplateId) {
    const existing = await findChildBySlug(templateId, "track-order");
    trackOrderTemplateId = existing
      ? existing.id
      : await createChildPage({
          parentId: templateId,
          rootId: templateId,
          userId,
          organizationId,
          name: "Track Order",
          slug: "track-order",
          designJson: buildTrackOrderDesignJson(),
        });
  }

  const patch = { storefrontTemplateId, storefrontCheckoutTemplateId, orderConfirmationTemplateId, trackOrderTemplateId };
  if (settings) {
    await CommerceSettings.patch({ templateId }).set(patch).go();
  } else {
    await CommerceSettings.create({ id: randomUUID(), templateId, organizationId, ...patch }).go();
  }
}

/** Current storefront slug, or null if Commerce's storefront hasn't been provisioned yet. */
export async function getStorefrontSlug(templateId: string): Promise<string | null> {
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  if (!settings?.storefrontTemplateId) return null;
  const { data: page } = await Template.get({ id: settings.storefrontTemplateId }).go();
  return page?.slug ?? null;
}

/** Renames the storefront's own slug (the checkout sub-page moves with it automatically,
 * since its parentId doesn't change). order-confirmation/track-order are never renameable —
 * see this file's top-of-file comment and the checkout/refund routes that hardcode them. */
export async function renameStorefrontSlug(templateId: string, newSlugInput: string): Promise<string> {
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  if (!settings?.storefrontTemplateId) {
    throw new Error("The storefront hasn't been created yet — enable Commerce first.");
  }
  const { data: page } = await Template.get({ id: settings.storefrontTemplateId }).go();
  if (!page) {
    throw new Error("The storefront page is missing — re-enable Commerce to recreate it.");
  }
  if (page.slug === newSlugInput) return page.slug;

  const base = newSlugInput.trim();
  if (!base) throw new Error("storefrontSlug cannot be empty.");
  // ensureUniqueSlug scans this page's OWN siblings under templateId for a collision; since
  // the page currently sits at its OLD slug (checked above), it can never collide with itself.
  const candidate = await ensureUniqueSlug(templateId, base);
  await Template.patch({ id: page.id }).set({ slug: candidate }).go();
  return candidate;
}
