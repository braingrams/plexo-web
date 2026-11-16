import { randomUUID } from "node:crypto";
import type { EntityItem } from "electrodb";
import { recompileSiteLayoutDependents } from "@/lib/siteLayoutCore";
import { ensureUniqueSlug } from "@/server/slugDynamo";
import { SiteLayout, Template } from "@/lib/db/contentEntities";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { designFormatOf, type DesignFormat } from "@/lib/v2/design";
import {
  buildCheckoutV2,
  buildOrderConfirmationV2,
  buildStorefrontV2,
  buildTrackOrderV2,
  DEFAULT_STORE_LINKS,
  type ChromeOptions,
  type StoreLinks,
} from "@/lib/v2/layoutDesigns";
import { chromeFor, compileGenerated, siteInfo } from "@/lib/v2/siteFormat";

type TemplateItem = EntityItem<typeof Template>;

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
 * MCP tool/route, which gates multi-page sites behind a paid plan
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

export function markerRow(type: string, attributes: Record<string, unknown> = {}, minHeight = "400px"): any {
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

/**
 * Which design a provisioned page gets: the classic row/column one for a classic (v1) site —
 * byte-for-byte what it always was — or the new editor's managed sections for a v2 site, so
 * the owner can open and edit it there. `chrome` carries the site name and whether the page
 * must bring its own header/footer (a site with a shared Site layout already has them).
 */
type PageKey = "storefront" | "checkout" | "confirmation" | "tracking";
type Plan = { format: DesignFormat; chrome: ChromeOptions; links: StoreLinks };

function designFor(key: PageKey, plan: Plan): any {
  if (plan.format === "v2") {
    const builders = { storefront: buildStorefrontV2, checkout: buildCheckoutV2, confirmation: buildOrderConfirmationV2, tracking: buildTrackOrderV2 };
    return builders[key](plan.chrome, plan.links);
  }
  const builders = { storefront: buildStorefrontDesignJson, checkout: buildCheckoutDesignJson, confirmation: buildOrderConfirmationDesignJson, tracking: buildTrackOrderDesignJson };
  return builders[key]();
}

async function planFor(rootTemplateId: string, shopPath?: string | null): Promise<Plan> {
  const info = await siteInfo(rootTemplateId);
  const chrome = info.format === "v2" ? await chromeFor(rootTemplateId, info.name) : { siteName: info.name, header: false, footer: false };
  return { format: info.format, chrome, links: { ...DEFAULT_STORE_LINKS, ...(shopPath ? { shopPath } : {}) } };
}

async function findChildBySlug(parentId: string, slug: string): Promise<{ id: string } | null> {
  const { data: siblings } = await Template.query.byParent({ parentId }).go({ pages: "all" });
  return siblings.find((s) => s.slug === slug) ?? null;
}

async function nextOrder(parentId: string): Promise<number> {
  const { data: siblings } = await Template.query.byParent({ parentId }).go({ pages: "all" });
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
  designFormat?: DesignFormat;
}): Promise<string> {
  const id = randomUUID();
  const designFormat = params.designFormat ?? "v1";
  const compiledHtml = await compileGenerated(params.rootId, { id, name: params.name, designFormat, designJson: params.designJson });
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
    ...(designFormat === "v2" ? { designFormat } : {}),
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
  // One decision per call: the site's format. A classic site gets the classic pages exactly
  // as before; a new-editor site gets editable sections. Pages that already exist are never
  // touched, whatever their format — this only fills in what's missing.
  const plan = await planFor(templateId);
  const base = { rootId: templateId, userId, organizationId, designFormat: plan.format } as const;

  let storefrontTemplateId = settings?.storefrontTemplateId ?? null;
  if (!storefrontTemplateId) {
    const existing = await findChildBySlug(templateId, DEFAULT_STOREFRONT_SLUG);
    storefrontTemplateId = existing
      ? existing.id
      : await createChildPage({ ...base, parentId: templateId, name: "Shop", slug: DEFAULT_STOREFRONT_SLUG, designJson: designFor("storefront", plan) });
  }
  // Every link the other pages carry points at the shop's REAL path (it can be renamed or live under a parent page).
  if (plan.format === "v2") plan.links.shopPath = (await pagePath(storefrontTemplateId)) ?? plan.links.shopPath;

  let storefrontCheckoutTemplateId = settings?.storefrontCheckoutTemplateId ?? null;
  if (!storefrontCheckoutTemplateId) {
    const existing = await findChildBySlug(storefrontTemplateId, "checkout");
    storefrontCheckoutTemplateId = existing
      ? existing.id
      : await createChildPage({ ...base, parentId: storefrontTemplateId, name: "Checkout", slug: "checkout", designJson: designFor("checkout", plan) });
  }

  let orderConfirmationTemplateId = settings?.orderConfirmationTemplateId ?? null;
  if (!orderConfirmationTemplateId) {
    const existing = await findChildBySlug(templateId, "order-confirmation");
    orderConfirmationTemplateId = existing
      ? existing.id
      : await createChildPage({ ...base, parentId: templateId, name: "Order Confirmation", slug: "order-confirmation", designJson: designFor("confirmation", plan) });
  }

  let trackOrderTemplateId = settings?.trackOrderTemplateId ?? null;
  if (!trackOrderTemplateId) {
    const existing = await findChildBySlug(templateId, "track-order");
    trackOrderTemplateId = existing
      ? existing.id
      : await createChildPage({ ...base, parentId: templateId, name: "Track Order", slug: "track-order", designJson: designFor("tracking", plan) });
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

/**
 * The storefront page's REAL served path, e.g. "/store" or "/lineagecare/shop" — a migrated
 * store's shop page can sit under a parent page, which the bare slug can't express.
 */
export async function getStorefrontPath(templateId: string): Promise<string | null> {
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  return settings?.storefrontTemplateId ? pagePath(settings.storefrontTemplateId) : null;
}

/** "/a/b" for a page in the site tree (the root contributes no segment), or null if it's gone. */
async function pagePath(pageId: string): Promise<string | null> {
  const segments: string[] = [];
  let currentId: string | null = pageId;
  while (currentId) {
    const page: TemplateItem | null = (await Template.get({ id: currentId }).go()).data;
    if (!page) return null;
    if (page.parentId) segments.unshift(page.slug ?? "");
    currentId = page.parentId ?? null;
  }
  return segments.length ? `/${segments.join("/")}` : null;
}

/**
 * The checkout page's REAL served path — not assumed to be "{storefrontSlug}/checkout".
 * That assumption holds for the auto-provisioned flow (ensureStorefrontLayout creates
 * checkout as a genuine child of the storefront page), but a hand-built site can freely
 * have its own checkout page anywhere in the tree, including as a sibling of the
 * storefront rather than a child (confirmed live: a site with storefrontCheckoutTemplateId
 * pointing at a top-level page, not nested under storefrontTemplateId at all — the old
 * "{storefrontPath}/checkout" concatenation in commerce.js produced a 404 for exactly this
 * site). Walks the checkout page's own parentId chain up to (but excluding) the root —
 * same "root contributes no path segment" convention app/pub/[domain]/[[...slug]]/route.ts
 * itself relies on — joining every slug in between.
 */
export async function getCheckoutPath(templateId: string): Promise<string | null> {
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  if (!settings?.storefrontCheckoutTemplateId) return null;

  const segments: string[] = [];
  let currentId: string | null = settings.storefrontCheckoutTemplateId;
  while (currentId) {
    const page: TemplateItem | null = (await Template.get({ id: currentId }).go()).data;
    if (!page) return null;
    if (page.parentId) segments.unshift(page.slug ?? "");
    currentId = page.parentId ?? null;
  }
  return segments.length ? `/${segments.join("/")}` : null;
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
  const oldPath = await pagePath(page.id);
  const candidate = await ensureUniqueSlug(templateId, base);
  await Template.patch({ id: page.id }).set({ slug: candidate }).go();
  const newPath = await pagePath(page.id);
  if (oldPath && newPath && oldPath !== newPath) await retargetStoreLinks(templateId, settings, oldPath, newPath);
  return candidate;
}

/**
 * Just the order-confirmation page, for a site that takes donations but doesn't sell
 * anything — a bank-transfer donor lands there to see the account details, and a
 * donations-only nonprofit shouldn't get a shop, checkout and order-tracking page it never
 * asked for. Idempotent, same rules as ensureStorefrontLayout (respects an existing page).
 */
export async function ensureOrderConfirmationPage(templateId: string, organizationId: string, userId: string): Promise<void> {
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  if (settings?.orderConfirmationTemplateId) return;
  const existing = await findChildBySlug(templateId, "order-confirmation");
  // A donations-only site may have no shop at all: its "Keep shopping" button then goes home, not to a page that isn't there.
  const shopPath = settings?.storefrontTemplateId ? await pagePath(settings.storefrontTemplateId) : null;
  const plan = await planFor(templateId, shopPath);
  if (plan.format === "v2" && !shopPath) plan.links.shopPath = "/";
  const orderConfirmationTemplateId = existing
    ? existing.id
    : await createChildPage({
        parentId: templateId,
        rootId: templateId,
        userId,
        organizationId,
        name: "Order Confirmation",
        slug: "order-confirmation",
        designJson: designFor("confirmation", plan),
        designFormat: plan.format,
      });
  if (settings) await CommerceSettings.patch({ templateId }).set({ orderConfirmationTemplateId }).go();
  else await CommerceSettings.create({ id: randomUUID(), templateId, organizationId, orderConfirmationTemplateId }).go();
}

/** Replaces every string in a JSON value that is exactly `from` with `to` (a link's address). Returns the same object when nothing matched. */
function replaceExactStrings(value: unknown, from: string, to: string): { value: unknown; changed: boolean } {
  if (typeof value === "string") return value === from ? { value: to, changed: true } : { value, changed: false };
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((v) => {
      const r = replaceExactStrings(v, from, to);
      changed ||= r.changed;
      return r.value;
    });
    return { value: changed ? next : value, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const r = replaceExactStrings(v, from, to);
      changed ||= r.changed;
      next[k] = r.value;
    }
    return { value: changed ? next : value, changed };
  }
  return { value, changed: false };
}

/**
 * The new-editor store pages Plexo generated carry the shop's address in their buttons and
 * menus (Back to the shop, Keep shopping, the header's Shop link). When the owner renames
 * the shop those would 404, so they follow it. Classic (v1) pages never carried the path, and
 * a page the owner built themselves is only touched where a link says exactly the old path.
 */
async function retargetStoreLinks(
  templateId: string,
  settings: { storefrontTemplateId?: string | null; storefrontCheckoutTemplateId?: string | null; orderConfirmationTemplateId?: string | null; trackOrderTemplateId?: string | null; productDetailTemplateId?: string | null },
  oldPath: string,
  newPath: string,
): Promise<void> {
  const { data: shared } = await SiteLayout.get({ templateId }).go();
  const ids = [
    settings.storefrontTemplateId,
    settings.storefrontCheckoutTemplateId,
    settings.orderConfirmationTemplateId,
    settings.trackOrderTemplateId,
    settings.productDetailTemplateId,
    shared?.headerTemplateId,
    shared?.footerTemplateId,
  ].filter((id): id is string => !!id);
  let touched = false;
  for (const id of ids) {
    const { data: page } = await Template.get({ id }).go();
    if (!page || designFormatOf(page) !== "v2") continue;
    const live = replaceExactStrings(page.designJson, oldPath, newPath);
    const draft = page.draftJson ? replaceExactStrings(page.draftJson, oldPath, newPath) : { value: page.draftJson, changed: false };
    if (!live.changed && !draft.changed) continue;
    await Template.patch({ id })
      .set({ ...(live.changed ? { designJson: live.value as any } : {}), ...(draft.changed ? { draftJson: draft.value as any } : {}) })
      .go();
    touched = true;
  }
  // Recompile this site's pages (the product page included) so the new links are what visitors get.
  if (touched) await recompileSiteLayoutDependents(templateId);
}
