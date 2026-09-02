import { randomUUID } from "node:crypto";
import { uploadObject } from "@/lib/storage";


import { Template, TemplateAsset } from "@/lib/db/contentEntities";
import { User, PlatformSettings } from "@/lib/db/coreEntities";

/** Same well-known system account plexo-admin's marketplaceOwner.ts creates/uses for
 * admin-curated listings — plexo-web never creates it (only plexo-admin's curation tools
 * do), it only needs to recognize it to skip seller-crediting on admin-curated sales. */
export const MARKETPLACE_OWNER_EMAIL = "templates@plexo.charisol.io";

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

export async function getMarketplaceOwnerUserId(): Promise<string | null> {
  const { data: matches } = await User.query.byEmail({ email: MARKETPLACE_OWNER_EMAIL }).go();
  return matches[0]?.id ?? null;
}

async function isAutoPublishEnabled(): Promise<boolean> {
  const { data: settings } = await PlatformSettings.get({}).go();
  if (settings) return settings.autoPublishMarketplaceListings ?? false;
  // Lazily seed the singleton row on first read, matching the Prisma upsert's
  // create-if-missing semantics — every field but id/updatedAt has a schema default.
  try {
    const { data: created } = await PlatformSettings.create({}).go();
    return created.autoPublishMarketplaceListings ?? false;
  } catch (err) {
    if (!isConditionalCheckFailure(err)) throw err;
    const { data: raced } = await PlatformSettings.get({}).go(); // lost the create race — someone else just seeded it
    return raced?.autoPublishMarketplaceListings ?? false;
  }
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
  const { data: source } = await Template.get({ id: sourceTemplateId }).go();
  if (!source || source.userId !== userId || source.organizationId !== organizationId || source.parentId) {
    throw new Error("Template not found.");
  }
  if (!source.compiledHtml.trim()) {
    throw new Error("This template has no content yet — save something before listing it for sale.");
  }

  const priceCents = input.priceCents && input.priceCents > 0 ? Math.round(input.priceCents) : null;
  const autoPublish = await isAutoPublishEnabled();
  const status: "PENDING_REVIEW" | "PUBLISHED" = autoPublish ? "PUBLISHED" : "PENDING_REVIEW";
  const newId = randomUUID();

  let copiedAssets: { templateId: string; path: string; blobUrl: string; contentType: string; size: number }[] = [];
  if (source.sourceType === "RAW_UPLOAD") {
    const { data: sourceAssets } = await TemplateAsset.query.primary({ templateId: source.id }).go();
    if (sourceAssets.length > 0) {
      copiedAssets = await Promise.all(
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
    }
  }

  await Template.create({
    id: newId,
    userId,
    organizationId,
    name: source.name,
    kind: source.kind,
    sourceType: source.sourceType,
    designJson: source.designJson,
    compiledHtml: source.compiledHtml,
    marketplaceStatus: status,
    marketplaceCategory: input.category?.trim() || undefined,
    marketplaceDescription: input.description?.trim() || undefined,
    priceCents: priceCents ?? undefined,
    marketplacePublishedAt: status === "PUBLISHED" ? new Date().toISOString() : undefined,
  }).go();

  if (copiedAssets.length > 0) {
    await Promise.all(copiedAssets.map((a) => TemplateAsset.create({ id: randomUUID(), ...a }).go()));
  }

  return { id: newId, status };
}
