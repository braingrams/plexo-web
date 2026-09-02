import { randomUUID } from "node:crypto";
import pLimit from "p-limit";
import { uploadObject } from "@/lib/storage";
import { safeFetch } from "@/lib/siteImport/fetchSafe";
import { ImportMediaMap } from "@/lib/db/importEntities";

// DynamoDB port of lib/blogImport/mediaRehost.ts — same behavior, same rationale (see that
// file's own comment) for every constant/decision. ImportMediaMap's primary key is
// (templateId, sourceUrl) — see importEntities.ts — so both the dedup lookup and the
// upsert-on-write are direct key operations, not a scan.
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const CONCURRENCY = 5;

const limit = pLimit(CONCURRENCY);

export function extractImageUrls(html: string): string[] {
  return Array.from(html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi), (m) => m[1]);
}

export function rewriteImageUrls(html: string, urlMap: Map<string, string>): string {
  let result = html;
  for (const [source, blobUrl] of urlMap) {
    result = result.split(source).join(blobUrl);
  }
  return result;
}

/**
 * Downloads every URL in `urls` from the source site and re-uploads it via
 * lib/storage.ts's uploadObject(), returning a sourceUrl -> new blobUrl map for rewriting
 * <img src> references. Backed by ImportMediaMap so a retried/resumed batch never
 * re-downloads a file it already moved — safe to call repeatedly with overlapping URL
 * lists across batches.
 */
export async function rehostMediaUrls(templateId: string, urls: string[], errors: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(urls.filter(Boolean)));
  if (unique.length === 0) return new Map();

  const existingBatches = await Promise.all(unique.map((sourceUrl) => ImportMediaMap.get({ templateId, sourceUrl }).go()));
  const resolved = new Map<string, string>();
  existingBatches.forEach((res, i) => {
    if (res.data) resolved.set(unique[i], res.data.blobUrl);
  });
  const toFetch = unique.filter((u) => !resolved.has(u));

  await Promise.all(
    toFetch.map((sourceUrl) =>
      limit(async () => {
        try {
          const res = await safeFetch(sourceUrl);
          if (!res.ok) {
            errors.push(`Media download failed (${res.status}): ${sourceUrl}`);
            return;
          }
          const contentType = res.headers.get("content-type") || "application/octet-stream";
          const buffer = Buffer.from(await res.arrayBuffer());
          if (buffer.byteLength > MAX_MEDIA_BYTES) {
            errors.push(`Media skipped (exceeds ${MAX_MEDIA_BYTES / 1024 / 1024}MB): ${sourceUrl}`);
            return;
          }
          const extension = sourceUrl.split(".").pop()?.split(/[?#]/)[0]?.slice(0, 5).replace(/[^a-z0-9]/gi, "") || "bin";
          const key = `blog-import/${templateId}/${Buffer.from(sourceUrl).toString("base64url").slice(0, 48)}.${extension}`;
          // key is a hash of sourceUrl — a "collision" is always identical content, so
          // uploadObject's unconditional overwrite is always safe here.
          const blob = await uploadObject(key, buffer, { access: "public", contentType });

          // .put() (not .create()) — same upsert semantics as the Prisma version's
          // `upsert`, needed for a resumed/retried batch re-writing the same sourceUrl.
          await ImportMediaMap.put({ id: randomUUID(), templateId, sourceUrl, blobUrl: blob.url }).go();
          resolved.set(sourceUrl, blob.url);
        } catch (err) {
          errors.push(`Media rehost error for ${sourceUrl}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    ),
  );

  return resolved;
}
