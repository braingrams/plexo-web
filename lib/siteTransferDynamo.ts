import { randomBytes } from "node:crypto";
import type { EntityItem } from "electrodb";

import { Template, PublishedDomain, SiteLayout, BlogSite, Comment } from "@/lib/db/contentEntities";
import { Organization } from "@/lib/db/coreEntities";
import { SiteImportJob, SiteTransferRequest } from "@/lib/db/importEntities";
import {
  CommerceCategory,
  CommerceProduct,
  CommerceProductRelation,
  CommerceDiscountCode,
  CommerceAvailabilityRule,
  CommerceAvailabilityException,
  CommerceCart,
  CommerceOrder,
  CommerceBooking,
  CommerceSettings,
  CommerceProductReview,
} from "@/lib/db/commerceEntities";
import { getTierFeatures } from "@/lib/subscription";
import { getOrganizationOwnerPlanDynamo } from "@/server/orgDynamo";

export const SITE_TRANSFER_EXPIRY_DAYS = 7;

/**
 * DynamoDB-native replacement for server/siteTransfer.ts. Every Template row that belongs
 * to this site — the root plus every descendant (parentId BFS via GSI2, matching
 * lib/siteLayoutDynamo.ts's recompileSiteLayoutDependents), plus the two kinds of
 * "referenced by id, not by parentId" fragment Templates a site can have: SiteLayout's
 * header/footer and CommerceSettings' Product Detail layout. A transfer has to move ALL of
 * these together, or the recipient ends up owning a site whose header/footer (or product
 * pages) still belong to the sender.
 */
export async function collectSiteTemplateIds(rootId: string): Promise<string[]> {
  const ids = new Set<string>([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    const childBatches = await Promise.all(frontier.map((pid) => Template.query.byParent({ parentId: pid }).go({ pages: "all" })));
    const children = childBatches.flatMap((b) => b.data);
    frontier = children.map((c) => c.id).filter((id) => !ids.has(id));
    frontier.forEach((id) => ids.add(id));
  }

  const [{ data: siteLayout }, { data: commerceSettings }, { data: blogSite }] = await Promise.all([
    SiteLayout.get({ templateId: rootId }).go(),
    CommerceSettings.get({ templateId: rootId }).go(),
    BlogSite.get({ templateId: rootId }).go(),
  ]);
  if (siteLayout?.headerTemplateId) ids.add(siteLayout.headerTemplateId);
  if (siteLayout?.footerTemplateId) ids.add(siteLayout.footerTemplateId);
  if (commerceSettings?.productDetailTemplateId) ids.add(commerceSettings.productDetailTemplateId);
  if (blogSite?.postLayoutTemplateId) ids.add(blogSite.postLayoutTemplateId);
  if (blogSite?.listingLayoutTemplateId) ids.add(blogSite.listingLayoutTemplateId);

  return Array.from(ids);
}

export type TransferWarning = { title: string; detail: string };

/**
 * Compares what this SITE actually uses against the RECIPIENT's plan — only the plan
 * gates that are genuinely enforced elsewhere in the app (see lib/subscription.ts), never
 * a guessed/invented restriction. Commerce and Blog are deliberately absent: neither is
 * plan-gated anywhere in this codebase, so they keep working regardless of the
 * recipient's plan.
 */
export async function computeTransferWarnings(
  rootId: string,
  recipientPlan: "FREE" | "PRO" | "ULTRA",
  recipientOrgId: string | null,
): Promise<TransferWarning[]> {
  const warnings: TransferWarning[] = [];
  const recipientFeatures = getTierFeatures(recipientPlan);

  const [{ data: subPages }, { data: domains }, { data: root }] = await Promise.all([
    Template.query.byParent({ parentId: rootId }).where((attr, op) => op.eq(attr.kind, "LANDING_PAGE")).go({ pages: "all" }),
    PublishedDomain.query.primary({ templateId: rootId }).go({ pages: "all" }),
    Template.get({ id: rootId }).go(),
  ]);
  const subPageCount = subPages.length;

  if (subPageCount > 0 && !recipientFeatures.multiPageSitesEnabled) {
    warnings.push({
      title: "Multi-page site on a plan that doesn't support it",
      detail: `This site has ${subPageCount} sub-page${subPageCount === 1 ? "" : "s"} beyond its home page. Multi-page sites are a Pro/Ultra feature — on a Free plan, the recipient won't be able to create new sub-pages, though already-published ones will keep serving.`,
    });
  }

  const customDomain = domains.find((d) => d.type === "CUSTOM");
  if (customDomain && !recipientFeatures.customDomainEnabled) {
    warnings.push({
      title: "Custom domain on a plan that doesn't support it",
      detail: `This site uses the custom domain "${customDomain.domain}". Custom domains require a Pro/Ultra plan — on a Free plan, the recipient won't be able to manage its DNS/domain settings (the domain may keep serving until something needs to change).`,
    });
  }

  if (root) {
    const [senderPlan, { data: org }] = await Promise.all([
      getOrganizationOwnerPlanDynamo(root.organizationId),
      Organization.get({ id: root.organizationId }).go(),
    ]);
    const senderFeatures = getTierFeatures(senderPlan);
    if (org?.whiteLabelEnabled && senderFeatures.whiteLabelEnabled && !recipientFeatures.whiteLabelEnabled) {
      warnings.push({
        title: "White-label branding on a plan that doesn't support it",
        detail: "This site's organization has white-label branding turned on. That requires a Pro/Ultra plan — on a Free plan, Plexo's own branding may reappear in the dashboard, emails, and this site's favicon.",
      });
    }
    if (senderFeatures.brandingRemovalEnabled && !recipientFeatures.brandingRemovalEnabled) {
      warnings.push({
        title: "\"Hosted with Plexo\" bar will reappear",
        detail: "The sender's plan currently hides the \"Hosted with Plexo\" bar on published pages. That requires a Pro/Ultra plan — on a Free plan, the bar will reappear on this site's pages.",
      });
    }
  }

  if (recipientOrgId) {
    const { data: recipientTemplates } = await Template.query.byOrg({ organizationId: recipientOrgId }).go({ pages: "all" });
    const recipientRootCount = recipientTemplates.filter(
      (t) => !t.parentId && t.kind === "LANDING_PAGE" && !t.marketplaceStatus && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout,
    ).length;
    if (recipientRootCount + 1 > recipientFeatures.maxLandingPages) {
      warnings.push({
        title: "This transfer would put the recipient over their site limit",
        detail: `The recipient's plan allows up to ${recipientFeatures.maxLandingPages} sites. They currently have ${recipientRootCount} — accepting this transfer would put them at ${recipientRootCount + 1}. This transferred site stays intact either way, but they may be blocked from creating new sites until they're back under the limit.`,
      });
    }
  }

  return warnings;
}

/**
 * The actual reassignment — every organizationId-scoped row belonging to this site's
 * template tree moves to the recipient's organization. DynamoDB has no multi-table
 * transaction spanning this many item types (and no cascade/updateMany), so each entity
 * type is fetched then patched explicitly — same discipline as every other bulk
 * reassignment this migration has done (e.g. app/api/v1/templates/[id]/route.ts's DELETE).
 * Not wrapped in a single atomic transaction: a partial failure here is a recoverable data
 * hygiene issue (some rows still show the old org), not a security hole, since every read
 * path scopes by templateId/organizationId together already.
 *
 * Deliberately excluded, matching the Prisma original:
 * - UploadedImage: the ORG's general media library, not scoped to one site.
 * - TemplateRevision/PageView/CommerceCartItem/CommerceOrderItem: no organizationId of
 *   their own, resolve through templateId/cartId/orderId — nothing to reassign.
 * - PaystackWebhookEvent (per-site idempotency log, lib/db/ledgerEntities.ts): keyed by
 *   bare id with no templateId-scoped index, only a byOrg GSI used for a support/debug
 *   listing. Reassigning it would require a full scan of the shared ledger table for a
 *   field with zero security/authorization impact — a real, flagged gap, not silently
 *   dropped, same discipline as this migration's other documented index gaps.
 */
export async function executeSiteTransfer(params: {
  rootId: string;
  toOrganizationId: string;
  toUserId: string;
}): Promise<void> {
  const { rootId, toOrganizationId, toUserId } = params;
  const templateIds = await collectSiteTemplateIds(rootId);

  await Promise.all(templateIds.map((id) => Template.patch({ id }).set({ organizationId: toOrganizationId, userId: toUserId }).go()));

  const domainBatches = await Promise.all(templateIds.map((tid) => PublishedDomain.query.primary({ templateId: tid }).go({ pages: "all" })));
  const domains = domainBatches.flatMap((b) => b.data);
  await Promise.all(domains.map((d) => PublishedDomain.patch({ templateId: d.templateId, id: d.id }).set({ organizationId: toOrganizationId, userId: toUserId }).go()));

  const { data: siteLayout } = await SiteLayout.get({ templateId: rootId }).go();
  if (siteLayout) await SiteLayout.patch({ templateId: rootId }).set({ organizationId: toOrganizationId }).go();

  const importJobBatches = await Promise.all(templateIds.map((tid) => SiteImportJob.query.primary({ templateId: tid }).go({ pages: "all" })));
  const importJobs = importJobBatches.flatMap((b) => b.data);
  await Promise.all(importJobs.map((j) => SiteImportJob.patch({ templateId: j.templateId, id: j.id }).set({ organizationId: toOrganizationId }).go()));

  const commentBatches = await Promise.all(templateIds.map((tid) => Comment.query.primary({ templateId: tid }).go({ pages: "all" })));
  const comments = commentBatches.flatMap((b) => b.data);
  await Promise.all(comments.map((c) => Comment.patch({ templateId: c.templateId, createdAt: c.createdAt, id: c.id }).set({ organizationId: toOrganizationId }).go()));

  // Everything below is scoped to rootId only, matching the Prisma original (Commerce/
  // SiteLayout/CommerceSettings only ever live on the root site, never a sub-page).
  const [{ data: categories }, { data: products }, { data: discounts }, { data: availRules }, { data: availExceptions }, { data: carts }, { data: orders }, { data: bookings }, { data: reviews }] =
    await Promise.all([
      CommerceCategory.query.primary({ templateId: rootId }).go({ pages: "all" }),
      CommerceProduct.query.primary({ templateId: rootId }).go({ pages: "all" }),
      CommerceDiscountCode.query.primary({ templateId: rootId }).go({ pages: "all" }),
      CommerceAvailabilityRule.query.primary({ templateId: rootId }).go({ pages: "all" }),
      CommerceAvailabilityException.query.primary({ templateId: rootId }).go({ pages: "all" }),
      CommerceCart.query.primary({ templateId: rootId }).go({ pages: "all" }),
      CommerceOrder.query.primary({ templateId: rootId }).go({ pages: "all" }),
      CommerceBooking.query.primary({ templateId: rootId }).go({ pages: "all" }),
      CommerceProductReview.query.primary({ templateId: rootId }).go({ pages: "all" }),
    ]);

  const relationBatches = await Promise.all(products.map((p) => CommerceProductRelation.query.primary({ productId: p.id }).go({ pages: "all" })));
  const relations = relationBatches.flatMap((b) => b.data);

  await Promise.all([
    ...categories.map((c) => CommerceCategory.patch({ templateId: c.templateId, id: c.id }).set({ organizationId: toOrganizationId }).go()),
    ...products.map((p) => CommerceProduct.patch({ templateId: p.templateId, id: p.id }).set({ organizationId: toOrganizationId }).go()),
    ...relations.map((r) => CommerceProductRelation.patch({ productId: r.productId, relatedProductId: r.relatedProductId }).set({ organizationId: toOrganizationId }).go()),
    ...discounts.map((d) => CommerceDiscountCode.patch({ templateId: d.templateId, id: d.id }).set({ organizationId: toOrganizationId }).go()),
    ...availRules.map((r) => CommerceAvailabilityRule.patch({ templateId: r.templateId, id: r.id }).set({ organizationId: toOrganizationId }).go()),
    ...availExceptions.map((e) => CommerceAvailabilityException.patch({ templateId: e.templateId, id: e.id }).set({ organizationId: toOrganizationId }).go()),
    ...carts.map((c) => CommerceCart.patch({ templateId: c.templateId, id: c.id }).set({ organizationId: toOrganizationId }).go()),
    ...orders.map((o) => CommerceOrder.patch({ templateId: o.templateId, id: o.id }).set({ organizationId: toOrganizationId }).go()),
    ...bookings.map((b) => CommerceBooking.patch({ templateId: b.templateId, orderId: b.orderId }).set({ organizationId: toOrganizationId }).go()),
    ...reviews.map((r) => CommerceProductReview.patch({ templateId: r.templateId, id: r.id }).set({ organizationId: toOrganizationId }).go()),
  ]);

  const { data: commerceSettings } = await CommerceSettings.get({ templateId: rootId }).go();
  if (commerceSettings) await CommerceSettings.patch({ templateId: rootId }).set({ organizationId: toOrganizationId }).go();
}

export function generateTransferToken(): string {
  return randomBytes(24).toString("hex");
}

// --- Access-pattern helpers the Prisma version got for free from `id @id` / @@index ---
// SiteTransferRequest's primary key is (templateId, id) — see lib/db/importEntities.ts's
// comment on why a bare-id/toEmail/fromOrganizationId GSI wasn't added speculatively.
// These are genuine bounded Scans over a low-volume, non-TTL'd entity (a real business
// action a user takes rarely), same discipline as scan-domains/resume-stalled/
// expire-stale-holds elsewhere in this migration — flagged here, not hidden.

export type SiteTransferItem = EntityItem<typeof SiteTransferRequest>;

/** Resolves a transfer by its own id alone — the dashboard detail page and the
 * accept/decline route only ever have this id, never the templateId it's nested under. */
export async function findTransferById(id: string): Promise<SiteTransferItem | null> {
  let cursor: string | null | undefined = undefined;
  do {
    const page: { data: SiteTransferItem[]; cursor: string | null } = await SiteTransferRequest.scan.where((attr, op) => op.eq(attr.id, id)).go({ cursor });
    const found = page.data[0];
    if (found) return found;
    cursor = page.cursor;
  } while (cursor);
  return null;
}

export async function listIncomingTransfers(toEmail: string): Promise<SiteTransferItem[]> {
  const { data } = await SiteTransferRequest.scan
    .where((attr, op) => `${op.eq(attr.toEmail, toEmail)} AND ${op.eq(attr.status, "PENDING")}`)
    .go({ pages: "all" });
  return data;
}

export async function listOutgoingTransfers(fromOrganizationId: string): Promise<SiteTransferItem[]> {
  const { data } = await SiteTransferRequest.scan
    .where((attr, op) => `${op.eq(attr.fromOrganizationId, fromOrganizationId)} AND ${op.eq(attr.status, "PENDING")}`)
    .go({ pages: "all" });
  return data;
}
