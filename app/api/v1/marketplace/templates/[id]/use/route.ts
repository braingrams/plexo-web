import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { uploadObject } from "@/lib/storage";

import { Template, TemplateAsset, TemplatePurchase } from "@/lib/db/contentEntities";
import { resolveUser } from "@/lib/auth/resolveUser";
import { getTierFeatures } from "@/lib/subscription";
import { ensureUniqueTemplateName } from "@/server/templateNameDynamo";

/**
 * POST /api/v1/marketplace/templates/:id/use
 * Spins up a new site/email in the caller's own account from a marketplace template —
 * requires the template be free or already purchased (checked here, not trusted from
 * the client). Duplicates content the same way app/api/templates/[id]/duplicate does
 * (including RAW_UPLOAD asset copying), landing in the caller's organization as a brand
 * new root template subject to their plan's normal template-count limit.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { data: listing } = await Template.get({ id }).go();
  if (!listing || listing.marketplaceStatus !== "PUBLISHED") {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const isFree = !listing.priceCents || listing.priceCents === 0;
  if (!isFree) {
    const { data: purchase } = await TemplatePurchase.get({ userId: resolved.userId, templateId: id }).go();
    if (!purchase) {
      return NextResponse.json({ error: "Purchase this template before using it." }, { status: 403 });
    }
  }

  const features = getTierFeatures(resolved.subscriptionPlan);
  {
    const limit = listing.kind === "LANDING_PAGE" ? features.maxLandingPages : features.maxEmailTemplates;
    const { data: orgRoots } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all" });
    const count = orgRoots.filter(
      (t) => !t.parentId && t.kind === listing.kind && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout,
    ).length;
    if (count >= limit) {
      const label = listing.kind === "LANDING_PAGE" ? "landing pages" : "email templates";
      return NextResponse.json(
        {
          error: `Your plan allows a maximum of ${limit} ${label}. Upgrade to create more.`,
          plan: resolved.subscriptionPlan,
        },
        { status: 403 },
      );
    }
  }

  const newId = randomUUID();
  const name = await ensureUniqueTemplateName({ organizationId: resolved.organizationId, parentId: null, kind: listing.kind, base: listing.name });

  if (listing.sourceType === "RAW_UPLOAD") {
    const { data: sourceAssets } = await TemplateAsset.query.primary({ templateId: listing.id }).go();
    if (sourceAssets.length > 0) {
      const copiedAssets = await Promise.all(
        sourceAssets.map(async (asset) => {
          const sourceRes = await fetch(asset.blobUrl);
          const buffer = Buffer.from(await sourceRes.arrayBuffer());
          const blob = await uploadObject(`raw-sites/${newId}/${asset.path}`, buffer, {
            access: "public",
            contentType: asset.contentType,
          });
          return {
            templateId: newId,
            path: asset.path,
            blobUrl: blob.url,
            contentType: asset.contentType,
            size: buffer.byteLength,
          };
        }),
      );
      await Template.create({
        id: newId,
        userId: resolved.userId,
        organizationId: resolved.organizationId,
        name,
        kind: listing.kind,
        sourceType: listing.sourceType,
        designJson: listing.designJson,
        compiledHtml: listing.compiledHtml,
      }).go();
      await Promise.all(copiedAssets.map((a) => TemplateAsset.create({ id: randomUUID(), ...a }).go()));
      return NextResponse.json({ template: { id: newId, name, kind: listing.kind } }, { status: 201 });
    }
  }

  await Template.create({
    id: newId,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    name,
    kind: listing.kind,
    sourceType: listing.sourceType,
    designJson: listing.designJson,
    compiledHtml: listing.compiledHtml,
  }).go();

  return NextResponse.json({ template: { id: newId, name, kind: listing.kind } }, { status: 201 });
}
