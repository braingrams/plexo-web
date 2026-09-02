import { createHash, randomUUID } from "node:crypto";
import { uploadObject } from "@/lib/storage";
import { isAllowedExtension, extensionOf } from "@/server/rawUpload";
import { safeFetch } from "./fetchSafe";
import { SiteImportAssetBlob } from "@/lib/db/importEntities";

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

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

/**
 * Downloads one asset referenced from a crawled page and re-hosts it on S3, content-
 * addressed per job (SiteImportAssetBlob, keyed by (jobId, sha256)) so N pages in the same
 * site sharing identical bytes (a theme stylesheet, a logo) upload exactly once instead of
 * once per page — TemplateAsset's own (templateId, path) semantics are untouched; this only
 * decides what blobUrl a given TemplateAsset row ends up pointing at. Caller is responsible
 * for creating that TemplateAsset row once this resolves.
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

  const { data: existing } = await SiteImportAssetBlob.get({ jobId, sha256 }).go();
  if (existing) {
    return { ok: true, asset: { blobUrl: existing.blobUrl, contentType: existing.contentType, size: existing.size } };
  }

  // One asset failing to upload (a transient storage hiccup, a misconfigured bucket) must
  // not take the whole page down with it — the caller (pageAssets.ts) leaves a failed
  // asset's reference pointing at its original external URL and keeps going, same
  // graceful-degradation principle as link rewriting. Confirmed against a real run: before
  // this try/catch existed, a single put() failure threw uncaught out of this function and
  // failed the entire page instead of just this one asset.
  try {
    const ext = extensionOf(relativePath) || "bin";
    const key = `site-import/${jobId}/${sha256}.${ext}`;
    // key is content-hashed — a "collision" is always identical bytes, so an unconditional
    // overwrite (uploadObject's only mode) is exactly the right behavior here.
    const blob = await uploadObject(key, buffer, { access: "public", contentType });

    try {
      await SiteImportAssetBlob.create({ id: randomUUID(), jobId, sha256, blobUrl: blob.url, contentType, size: buffer.byteLength }).go();
    } catch (err) {
      if (!isConditionalCheckFailure(err)) throw err; // lost the create race — another page already recorded this same hash
    }

    return { ok: true, asset: { blobUrl: blob.url, contentType, size: buffer.byteLength } };
  } catch (err) {
    return { ok: false, reason: `Asset upload error for ${sourceUrl}: ${err instanceof Error ? err.message : String(err)}` };
  }
}
