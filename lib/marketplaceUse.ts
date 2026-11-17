import { randomUUID } from "node:crypto";

import { recompileCopiedV2Page } from "@/lib/v2/copy";
import { uploadObject } from "@/lib/storage";
import { Template, TemplateAsset, TemplatePurchase } from "@/lib/db/contentEntities";
import type { resolveUser } from "@/lib/auth/resolveUser";
import { getTierFeatures } from "@/lib/subscription";
import { ensureUniqueTemplateName } from "@/server/templateNameDynamo";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

/** A refusal whose message is already plain English for the owner, with the HTTP status the route answers with. */
export class MarketplaceUseError extends Error {
  constructor(message: string, readonly status: number, readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "MarketplaceUseError";
  }
}

/**
 * Spins up a new site/email in the caller's own account from a marketplace template —
 * requires the template be free or already purchased (checked here, never trusted from the
 * client). Duplicates content the same way app/api/templates/[id]/duplicate does (including
 * RAW_UPLOAD asset copying), landing in the caller's organization as a brand new root
 * template subject to their plan's normal template-count limit. Shared by
 * POST /api/v1/marketplace/templates/:id/use and SOL's create_site_from_template.
 */
export async function useMarketplaceTemplate(
  resolved: ResolvedUser,
  id: string,
  opts: { name?: string } = {},
): Promise<{ id: string; name: string; kind: "EMAIL" | "LANDING_PAGE"; designFormat: string }> {
  const { data: listing } = await Template.get({ id }).go();
  if (!listing || listing.marketplaceStatus !== "PUBLISHED") throw new MarketplaceUseError("We could not find that design. It may have been taken down.", 404);

  const isFree = !listing.priceCents || listing.priceCents === 0;
  if (!isFree) {
    const { data: purchase } = await TemplatePurchase.get({ userId: resolved.userId, templateId: id }).go();
    if (!purchase) throw new MarketplaceUseError("Buy this design first, then you can use it.", 403);
  }

  const features = getTierFeatures(resolved.subscriptionPlan);
  const limit = listing.kind === "LANDING_PAGE" ? features.maxLandingPages : features.maxEmailTemplates;
  const { data: orgRoots } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all" });
  const count = orgRoots.filter((t) => !t.parentId && t.kind === listing.kind && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout).length;
  if (count >= limit) {
    const label = listing.kind === "LANDING_PAGE" ? "landing pages" : "email templates";
    throw new MarketplaceUseError(`Your plan allows a maximum of ${limit} ${label}. Upgrade to create more.`, 403, { plan: resolved.subscriptionPlan });
  }

  const newId = randomUUID();
  const base = opts.name?.trim() || listing.name;
  const name = await ensureUniqueTemplateName({ organizationId: resolved.organizationId, parentId: null, kind: listing.kind, base });
  const designFormat = listing.designFormat ?? "v1";

  if (listing.sourceType === "RAW_UPLOAD") {
    const { data: sourceAssets } = await TemplateAsset.query.primary({ templateId: listing.id }).go();
    if (sourceAssets.length > 0) {
      const copiedAssets = await Promise.all(
        sourceAssets.map(async (asset) => {
          const sourceRes = await fetch(asset.blobUrl);
          const buffer = Buffer.from(await sourceRes.arrayBuffer());
          const blob = await uploadObject(`raw-sites/${newId}/${asset.path}`, buffer, { access: "public", contentType: asset.contentType });
          return { templateId: newId, path: asset.path, blobUrl: blob.url, contentType: asset.contentType, size: buffer.byteLength };
        }),
      );
      await Template.create({
        id: newId,
        userId: resolved.userId,
        organizationId: resolved.organizationId,
        name,
        kind: listing.kind,
        designFormat,
        sourceType: listing.sourceType,
        designJson: listing.designJson,
        compiledHtml: listing.compiledHtml,
      }).go();
      await Promise.all(copiedAssets.map((a) => TemplateAsset.create({ id: randomUUID(), ...a }).go()));
      return { id: newId, name, kind: listing.kind, designFormat };
    }
  }

  await Template.create({
    id: newId,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    name,
    kind: listing.kind,
    designFormat,
    sourceType: listing.sourceType,
    designJson: listing.designJson,
    compiledHtml: listing.compiledHtml,
  }).go();
  await recompileCopiedV2Page(newId);
  return { id: newId, name, kind: listing.kind, designFormat };
}
