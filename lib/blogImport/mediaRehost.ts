import { put } from "@vercel/blob";
import pLimit from "p-limit";
import { prisma } from "@/server/prisma";

// WordPress media libraries commonly hold multi-megabyte photos straight from a
// phone/DSLR — generous, but bounded so one oversized file can't blow the batch's time
// budget or memory. Oversized/failed downloads are skipped (not fatal) and reported by
// the caller in the job's error log.
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
 * Downloads every URL in `urls` from the source WordPress site and re-uploads it to
 * @vercel/blob (same put() pattern as every other upload path in this app), returning a
 * sourceUrl -> new blobUrl map for rewriting <img src> references. Backed by
 * ImportMediaMap so a retried/resumed batch never re-downloads a file it already moved —
 * safe to call repeatedly with overlapping URL lists across batches.
 */
export async function rehostMediaUrls(templateId: string, urls: string[], errors: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(urls.filter(Boolean)));
  if (unique.length === 0) return new Map();

  const existing = await prisma.importMediaMap.findMany({ where: { templateId, sourceUrl: { in: unique } } });
  const resolved = new Map(existing.map((e) => [e.sourceUrl, e.blobUrl]));
  const toFetch = unique.filter((u) => !resolved.has(u));
  const localDevToken = process.env.BLOB_READ_WRITE_TOKEN; // OIDC covers real deployments — see upload-raw/route.ts

  await Promise.all(
    toFetch.map((sourceUrl) =>
      limit(async () => {
        try {
          const res = await fetch(sourceUrl);
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
          const blob = await put(key, buffer, {
            access: "public",
            contentType,
            allowOverwrite: true, // key is a hash of sourceUrl — a "collision" is always identical content, so overwriting is always safe
            ...(localDevToken ? { token: localDevToken } : {}),
          });

          await prisma.importMediaMap.upsert({
            where: { templateId_sourceUrl: { templateId, sourceUrl } },
            create: { templateId, sourceUrl, blobUrl: blob.url },
            update: { blobUrl: blob.url },
          });
          resolved.set(sourceUrl, blob.url);
        } catch (err) {
          errors.push(`Media rehost error for ${sourceUrl}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    ),
  );

  return resolved;
}
