import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/server/prisma";

/** Same well-known system account plexo-admin's marketplaceOwner.ts creates/uses for
 * admin-curated listings — plexo-web never creates it (only plexo-admin's curation tools
 * do), it only needs to recognize it to skip seller-crediting on admin-curated sales. */
export const MARKETPLACE_OWNER_EMAIL = "templates@plexo.charisol.io";

export async function getMarketplaceOwnerUserId(): Promise<string | null> {
  const owner = await prisma.user.findUnique({
    where: { email: MARKETPLACE_OWNER_EMAIL },
    select: { id: true },
  });
  return owner?.id ?? null;
}

async function isAutoPublishEnabled(): Promise<boolean> {
  const settings = await prisma.platformSettings.upsert({
    where: { id: "global" },
    create: { id: "global" },
    update: {},
    select: { autoPublishMarketplaceListings: true },
  });
  return settings.autoPublishMarketplaceListings;
}

export type SubmitListingInput = {
  priceCents: number | null;
  category: string | null;
  description: string | null;
};

/**
 * Clones one of the caller's own root templates into a new marketplace listing, owned by
 * the SAME real seller (unlike plexo-admin's duplicateForMarketplace, which reassigns
 * ownership to a system account) — the seller needs to stay attributed for payout, and
 * the clone (not the live working template) is what's decoupled from their future
 * edits/deletes, mirroring the isolation duplicateForMarketplace was built for.
 */
export async function submitTemplateForMarketplace(
  userId: string,
  organizationId: string,
  sourceTemplateId: string,
  input: SubmitListingInput,
): Promise<{ id: string; status: "PENDING_REVIEW" | "PUBLISHED" }> {
  const source = await prisma.template.findFirst({
    where: { id: sourceTemplateId, userId, organizationId, parentId: null },
    select: { id: true, name: true, kind: true, sourceType: true, designJson: true, compiledHtml: true },
  });
  if (!source) throw new Error("Template not found.");
  if (!source.compiledHtml.trim()) {
    throw new Error("This template has no content yet — save something before listing it for sale.");
  }

  const priceCents = input.priceCents && input.priceCents > 0 ? Math.round(input.priceCents) : null;
  const autoPublish = await isAutoPublishEnabled();
  const status: "PENDING_REVIEW" | "PUBLISHED" = autoPublish ? "PUBLISHED" : "PENDING_REVIEW";
  const newId = randomUUID();

  let copiedAssets: { templateId: string; path: string; blobUrl: string; contentType: string; size: number }[] = [];
  if (source.sourceType === "RAW_UPLOAD") {
    const sourceAssets = await prisma.templateAsset.findMany({ where: { templateId: source.id } });
    if (sourceAssets.length > 0) {
      const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
      copiedAssets = await Promise.all(
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
    }
  }

  await prisma.template.create({
    data: {
      id: newId,
      userId,
      organizationId,
      name: source.name,
      kind: source.kind,
      sourceType: source.sourceType,
      designJson: source.designJson as Prisma.InputJsonValue,
      compiledHtml: source.compiledHtml,
      marketplaceStatus: status,
      marketplaceCategory: input.category?.trim() || null,
      marketplaceDescription: input.description?.trim() || null,
      priceCents,
      marketplacePublishedAt: status === "PUBLISHED" ? new Date() : null,
    },
  });

  if (copiedAssets.length > 0) {
    await prisma.templateAsset.createMany({ data: copiedAssets });
  }

  return { id: newId, status };
}
