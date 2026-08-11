import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { prisma } from "@/server/prisma";
import { isAllowedExtension, extensionOf } from "@/server/rawUpload";
import { safeFetch } from "./fetchSafe";

// Matches blog-import's existing mediaRehost.ts cap/convention — generous enough for real
// site imagery, bounded so one oversized file can't blow a batch's time/memory budget.
export const MAX_SITE_IMPORT_ASSET_BYTES = 20 * 1024 * 1024;

export interface InternalizedAsset {
  blobUrl: string;
  contentType: string;
  size: number;
}

export type InternalizeAssetResult =
  | { ok: true; asset: InternalizedAsset }
  | { ok: false; reason: string };

/**
 * Downloads one asset referenced from a crawled page and re-hosts it on Vercel Blob,
 * content-addressed per job (SiteImportAssetBlob, keyed by (jobId, sha256)) so N pages in the
 * same site sharing identical bytes (a theme stylesheet, a logo) upload exactly once instead
 * of once per page — TemplateAsset's own (templateId, path) semantics are untouched; this only
 * decides what blobUrl a given TemplateAsset row ends up pointing at. Caller is responsible for
 * creating that TemplateAsset row once this resolves.
 */
export async function internalizeAsset(jobId: string, relativePath: string, sourceUrl: string): Promise<InternalizeAssetResult> {
  if (!isAllowedExtension(relativePath)) {
    return { ok: false, reason: `Skipped (disallowed file type): ${sourceUrl}` };
  }

  let buffer: Buffer;
  let contentType: string;
  try {
    const res = await safeFetch(sourceUrl);
    if (!res.ok) return { ok: false, reason: `Asset download failed (${res.status}): ${sourceUrl}` };
    contentType = res.headers.get("content-type") || "application/octet-stream";
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    return { ok: false, reason: `Asset download error for ${sourceUrl}: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (buffer.byteLength > MAX_SITE_IMPORT_ASSET_BYTES) {
    return { ok: false, reason: `Asset skipped (exceeds ${MAX_SITE_IMPORT_ASSET_BYTES / 1024 / 1024}MB): ${sourceUrl}` };
  }

  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const existing = await prisma.siteImportAssetBlob.findUnique({ where: { jobId_sha256: { jobId, sha256 } } });
  if (existing) {
    return { ok: true, asset: { blobUrl: existing.blobUrl, contentType: existing.contentType, size: existing.size } };
  }

  // One asset failing to upload (a transient Blob-storage hiccup, a misconfigured token)
  // must not take the whole page down with it — the caller (pageAssets.ts) leaves a failed
  // asset's reference pointing at its original external URL and keeps going, same
  // graceful-degradation principle as link rewriting. Confirmed against a real run: before
  // this try/catch existed, a single put() failure threw uncaught out of this function and
  // failed the entire page instead of just this one asset.
  try {
    const ext = extensionOf(relativePath) || "bin";
    const key = `site-import/${jobId}/${sha256}.${ext}`;
    const localDevToken = process.env.BLOB_READ_WRITE_TOKEN; // OIDC covers real deployments — see upload-raw/route.ts
    const blob = await put(key, buffer, {
      access: "public",
      contentType,
      allowOverwrite: true, // key is content-hashed — a "collision" is always identical bytes
      ...(localDevToken ? { token: localDevToken } : {}),
    });

    await prisma.siteImportAssetBlob.upsert({
      where: { jobId_sha256: { jobId, sha256 } },
      create: { jobId, sha256, blobUrl: blob.url, contentType, size: buffer.byteLength },
      update: {},
    });

    return { ok: true, asset: { blobUrl: blob.url, contentType, size: buffer.byteLength } };
  } catch (err) {
    return { ok: false, reason: `Asset upload error for ${sourceUrl}: ${err instanceof Error ? err.message : String(err)}` };
  }
}
