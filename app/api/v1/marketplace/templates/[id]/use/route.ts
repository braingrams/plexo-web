import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { put } from "@vercel/blob";

import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { getTierFeatures } from "@/lib/subscription";

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
  const listing = await prisma.template.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      kind: true,
      sourceType: true,
      designJson: true,
      compiledHtml: true,
      marketplaceStatus: true,
      priceCents: true,
    },
  });
  if (!listing || listing.marketplaceStatus !== "PUBLISHED") {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const isFree = !listing.priceCents || listing.priceCents === 0;
  if (!isFree) {
    const purchase = await prisma.templatePurchase.findUnique({
      where: { userId_templateId: { userId: resolved.userId, templateId: id } },
    });
    if (!purchase) {
      return NextResponse.json({ error: "Purchase this template before using it." }, { status: 403 });
    }
  }

  const features = getTierFeatures(resolved.subscriptionPlan);
  {
    const limit = listing.kind === "LANDING_PAGE" ? features.maxLandingPages : features.maxEmailTemplates;
    const count = await prisma.template.count({ where: { organizationId: resolved.organizationId, parentId: null, kind: listing.kind } });
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

  if (listing.sourceType === "RAW_UPLOAD") {
    const sourceAssets = await prisma.templateAsset.findMany({ where: { templateId: listing.id } });
    if (sourceAssets.length > 0) {
      const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
      const copiedAssets = await Promise.all(
        sourceAssets.map(async (asset) => {
          const sourceRes = await fetch(asset.blobUrl);
          const buffer = Buffer.from(await sourceRes.arrayBuffer());
          const blob = await put(`raw-sites/${newId}/${asset.path}`, buffer, {
            access: "public",
            contentType: asset.contentType,
            ...(blobToken ? { token: blobToken } : {}),
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
      const created = await prisma.template.create({
        data: {
          id: newId,
          userId: resolved.userId,
          organizationId: resolved.organizationId,
          name: listing.name,
          kind: listing.kind,
          sourceType: listing.sourceType,
          designJson: listing.designJson as Prisma.InputJsonValue,
          compiledHtml: listing.compiledHtml,
        },
        select: { id: true, name: true, kind: true },
      });
      await prisma.templateAsset.createMany({ data: copiedAssets });
      return NextResponse.json({ template: created }, { status: 201 });
    }
  }

  const created = await prisma.template.create({
    data: {
      id: newId,
      userId: resolved.userId,
      organizationId: resolved.organizationId,
      name: listing.name,
      kind: listing.kind,
      sourceType: listing.sourceType,
      designJson: listing.designJson as Prisma.InputJsonValue,
      compiledHtml: listing.compiledHtml,
    },
    select: { id: true, name: true, kind: true },
  });

  return NextResponse.json({ template: created }, { status: 201 });
}
