import { randomBytes } from "node:crypto";
import { prisma } from "@/server/prisma";
import { getTierFeatures, getOrganizationOwnerPlan, type SubscriptionPlan } from "@/lib/subscription";

export const SITE_TRANSFER_EXPIRY_DAYS = 7;

/**
 * Every Template row that belongs to this site — the root plus every descendant
 * (parentId BFS), plus the two kinds of "referenced by id, not by parentId" fragment
 * Templates a site can have: SiteLayout's header/footer and CommerceSettings' Product
 * Detail layout. A transfer has to move ALL of these together, or the recipient ends up
 * owning a site whose header/footer (or product pages) still belong to the sender.
 */
export async function collectSiteTemplateIds(rootId: string): Promise<string[]> {
  const ids = new Set<string>([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await prisma.template.findMany({ where: { parentId: { in: frontier } }, select: { id: true } });
    frontier = children.map((c) => c.id).filter((id) => !ids.has(id));
    frontier.forEach((id) => ids.add(id));
  }

  const [siteLayout, commerceSettings, blogSite] = await Promise.all([
    prisma.siteLayout.findUnique({ where: { templateId: rootId }, select: { headerTemplateId: true, footerTemplateId: true } }),
    prisma.commerceSettings.findUnique({ where: { templateId: rootId }, select: { productDetailTemplateId: true } }),
    prisma.blogSite.findUnique({ where: { templateId: rootId }, select: { postLayoutTemplateId: true, listingLayoutTemplateId: true } }),
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
export async function computeTransferWarnings(rootId: string, recipientPlan: SubscriptionPlan, recipientOrgId: string | null): Promise<TransferWarning[]> {
  const warnings: TransferWarning[] = [];
  const recipientFeatures = getTierFeatures(recipientPlan);

  const [subPageCount, domains, root] = await Promise.all([
    prisma.template.count({ where: { parentId: rootId, kind: "LANDING_PAGE" } }),
    prisma.publishedDomain.findMany({ where: { templateId: rootId }, select: { domain: true, type: true } }),
    prisma.template.findUnique({ where: { id: rootId }, select: { organizationId: true, userId: true } }),
  ]);

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
    const [senderPlan, org] = await Promise.all([
      getOrganizationOwnerPlan(root.organizationId),
      prisma.organization.findUnique({ where: { id: root.organizationId }, select: { whiteLabelEnabled: true } }),
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
    const recipientRootCount = await prisma.template.count({
      where: { organizationId: recipientOrgId, parentId: null, kind: "LANDING_PAGE", marketplaceStatus: null, isBlogLayout: false, isSiteLayoutFragment: false, isCommerceLayout: false },
    });
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
 * template tree moves to the recipient's organization in one transaction. UploadedImage
 * is deliberately excluded: it's the ORG's general media library (reused across all that
 * org's sites), not scoped to one site, so transferring one site must never move it.
 * TemplateRevision/PageView are excluded too — neither carries its own organizationId,
 * both resolve through their templateId, so they "follow" the Template automatically with
 * nothing to reassign.
 */
export async function executeSiteTransfer(params: {
  rootId: string;
  toOrganizationId: string;
  toUserId: string;
}): Promise<void> {
  const { rootId, toOrganizationId, toUserId } = params;
  const templateIds = await collectSiteTemplateIds(rootId);

  await prisma.$transaction([
    prisma.template.updateMany({ where: { id: { in: templateIds } }, data: { organizationId: toOrganizationId, userId: toUserId } }),
    prisma.publishedDomain.updateMany({ where: { templateId: { in: templateIds } }, data: { organizationId: toOrganizationId, userId: toUserId } }),
    prisma.siteLayout.updateMany({ where: { templateId: rootId }, data: { organizationId: toOrganizationId } }),
    prisma.siteImportJob.updateMany({ where: { templateId: rootId }, data: { organizationId: toOrganizationId } }),
    prisma.comment.updateMany({ where: { templateId: { in: templateIds } }, data: { organizationId: toOrganizationId } }),
    prisma.commerceCategory.updateMany({ where: { templateId: rootId }, data: { organizationId: toOrganizationId } }),
    prisma.commerceProduct.updateMany({ where: { templateId: rootId }, data: { organizationId: toOrganizationId } }),
    prisma.commerceProductRelation.updateMany({ where: { templateId: rootId }, data: { organizationId: toOrganizationId } }),
    prisma.commerceDiscountCode.updateMany({ where: { templateId: rootId }, data: { organizationId: toOrganizationId } }),
    prisma.commerceAvailabilityRule.updateMany({ where: { templateId: rootId }, data: { organizationId: toOrganizationId } }),
    prisma.commerceAvailabilityException.updateMany({ where: { templateId: rootId }, data: { organizationId: toOrganizationId } }),
    prisma.commerceCart.updateMany({ where: { templateId: rootId }, data: { organizationId: toOrganizationId } }),
    prisma.commerceOrder.updateMany({ where: { templateId: rootId }, data: { organizationId: toOrganizationId } }),
    prisma.commerceBooking.updateMany({ where: { templateId: rootId }, data: { organizationId: toOrganizationId } }),
    prisma.commerceSettings.updateMany({ where: { templateId: rootId }, data: { organizationId: toOrganizationId } }),
    prisma.paystackWebhookEvent.updateMany({ where: { templateId: rootId }, data: { organizationId: toOrganizationId } }),
    prisma.commerceProductReview.updateMany({ where: { templateId: rootId }, data: { organizationId: toOrganizationId } }),
  ]);
}

export function generateTransferToken(): string {
  return randomBytes(24).toString("hex");
}
