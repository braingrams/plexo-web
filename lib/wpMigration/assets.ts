import { createHash, randomUUID } from "node:crypto";
import { uploadObject } from "@/lib/storage";
import { contentTypeFor, extensionOf } from "@/server/rawUpload";
import { TemplateAsset } from "@/lib/db/contentEntities";
import { SiteImportAssetBlob } from "@/lib/db/importEntities";
import { FirewallBlockedError, firewallBlockOf, migrationFetch } from "./http";
import { assetPathFromRef, hostVariants, makeOriginRewriter } from "./urlSpace";
import { harvestLazyAssets } from "./lazyAssets";

// Every file a migrated page loads — theme and plugin CSS/JS, web fonts, every image size
// WordPress generated, PDFs linked from content — is copied to Plexo storage and served
// from exactly the path it had on WordPress (see urlSpace.ts for why). This file is the
// per-file worker: fetch it, sanity-check it, discover anything it references in turn
// (a stylesheet's fonts and background images, an @import), and store it.

// Broader than a raw zip upload's allowlist (server/rawUpload.ts): a WordPress media
// library routinely holds PDFs, audio and video the owner links to from their content,
// and losing those is exactly the kind of silent gap a migration must not have.
export const MIGRATION_ASSET_EXTENSIONS = new Set([
  "css", "js", "mjs", "json", "map", "txt", "xml", "webmanifest",
  "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "bmp",
  "woff", "woff2", "ttf", "otf", "eot",
  "pdf", "mp4", "webm", "ogv", "mp3", "wav", "m4a", "ogg",
]);

// Large enough for real media-library video/PDFs; bounded so one file can't exhaust a
// step's memory/time budget. Anything bigger is reported, never silently dropped.
export const MAX_MIGRATION_ASSET_BYTES = 50 * 1024 * 1024;

const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi;
const CSS_IMPORT_RE = /@import\s+(?:url\()?\s*(['"])([^'"]+)\1/gi;
// Inside JS we only trust paths that are unmistakably WordPress-served files — JS is full
// of strings that merely look like paths.
const JS_WP_PATH_RE = /(?<![\w/\\:.])(\\?\/(?:[\w.~%@+-]+\\?\/)*wp-(?:content|includes)\\?\/[\w.~%@+\-/\\]+?\.(?:css|js|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf|eot|json))(?=[?#"'\s),\\]|$)/gi;

export type AssetFetchResult =
  | {
      ok: true;
      buffer: Buffer;
      contentType: string;
      /** Files this one references — expected to exist. */
      discovered: string[][];
      /** Files a plugin may fetch at runtime (see lazyAssets.ts) — a miss means "not used here". */
      optional: string[][];
    }
  | { ok: false; skipped: boolean; reason: string; /** The host was busy or throttling ("too many requests") — worth trying again later. */ retryable?: boolean };

function encodePath(segments: string[]): string {
  return segments.map((s) => encodeURIComponent(s)).join("/");
}

function sameSitePathsFromCss(css: string, cssUrl: string, origin: string): string[][] {
  const hosts = new Set(hostVariants(origin));
  const found: string[][] = [];
  const consider = (ref: string) => {
    const trimmed = ref.trim();
    // url(#id) / url(./#id) reference an SVG filter or gradient inside the document, not a file.
    if (!trimmed || /^(data|blob|about):/i.test(trimmed) || /^(\.\/)?(#|%23)/i.test(trimmed)) return;
    try {
      const u = new URL(trimmed, cssUrl);
      if (!hosts.has(u.host)) return;
      const segments = assetPathFromRef(u.pathname);
      if (segments) found.push(segments);
    } catch {
      // unparseable reference — leave it
    }
  };
  for (const m of css.matchAll(CSS_URL_RE)) consider(m[2]);
  for (const m of css.matchAll(CSS_IMPORT_RE)) consider(m[2]);
  return found;
}

const MAX_FILE_REDIRECTS = 3;

/**
 * Fetches a file, following a redirect only while it still points at the same file name
 * (http→https, www, a CDN). Many sites send every missing file to the homepage instead of
 * answering 404 — following that downloads the whole homepage (on one slow site, 22s and
 * ~450KB per missing file) only to throw it away. Such a redirect comes back as the 3xx
 * response itself, which the caller treats as missing.
 */
async function fetchSameFile(url: string): Promise<Response> {
  const fileName = (u: string) => new URL(u).pathname.split("/").pop() ?? "";
  let current = url;
  for (let hop = 0; ; hop++) {
    const res = await migrationFetch(current, { returnRedirects: true });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get("location");
    const next = location ? new URL(location, current).toString() : null;
    if (!next || hop >= MAX_FILE_REDIRECTS || fileName(next) !== fileName(url)) return res;
    await res.body?.cancel().catch(() => {});
    current = next;
  }
}

/**
 * Downloads one file from the source site at its original path. Root-relative references
 * inside CSS/JS are left alone (they resolve identically on Plexo); absolute references to
 * the source domain are rewritten to root-relative so they follow the site to its new host.
 */
export async function fetchSourceAsset(origin: string, segments: string[]): Promise<AssetFetchResult> {
  const path = segments.join("/");
  const ext = extensionOf(path);
  // Cloudflare injects these into the pages it proxies (bot checks, analytics); they aren't part of
  // the WordPress site, they stall or refuse non-browser requests, and the new host's own
  // Cloudflare serves them anyway.
  if (segments[0] === "cdn-cgi") {
    return { ok: false, skipped: true, reason: "Added by Cloudflare, not part of your WordPress site" };
  }
  if (!MIGRATION_ASSET_EXTENSIONS.has(ext)) {
    return { ok: false, skipped: true, reason: `File type ".${ext || "none"}" isn't something a website loads directly` };
  }
  const url = `${origin}/${encodePath(segments)}`;
  let res: Response;
  try {
    res = await fetchSameFile(url);
  } catch (err) {
    return { ok: false, skipped: false, retryable: true, reason: `Couldn't download: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (res.status === 404 || res.status === 410 || (res.status >= 300 && res.status < 400)) {
    return { ok: false, skipped: true, reason: "Referenced by your site but missing on WordPress too (already broken there)" };
  }
  if (!res.ok) {
    const firewall = firewallBlockOf(res.status, await res.text().catch(() => ""));
    if (firewall) throw new FirewallBlockedError(firewall); // pauses the migration with what to do
  }
  if (res.status === 429 || res.status >= 500) return { ok: false, skipped: false, retryable: true, reason: `WordPress was too busy to send it (${res.status})` };
  if (!res.ok) return { ok: false, skipped: false, reason: `WordPress answered ${res.status}` };

  const headerType = (res.headers.get("content-type") || "").toLowerCase();
  // Catch-all hosting (and some security plugins) answer a missing file with a 200 HTML
  // page. Storing that under "logo.png" would be worse than storing nothing.
  if (headerType.includes("text/html")) {
    return { ok: false, skipped: true, reason: "Referenced by your site but missing on WordPress too (it served a web page instead of the file)" };
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_MIGRATION_ASSET_BYTES) {
    return { ok: false, skipped: false, reason: `Larger than ${MAX_MIGRATION_ASSET_BYTES / 1024 / 1024}MB — upload it to your Plexo media library manually` };
  }

  // The serve route sends X-Content-Type-Options: nosniff, so a stylesheet labelled
  // text/plain by a misconfigured host would be refused by the browser — trust the
  // extension first, the source server's header second.
  const byExt = contentTypeFor(path);
  const contentType = byExt !== "application/octet-stream" ? byExt : headerType.split(";")[0] || byExt;

  if (ext === "css") {
    const rewrite = makeOriginRewriter(origin);
    const css = rewrite(buffer.toString("utf8"));
    return { ok: true, buffer: Buffer.from(css, "utf8"), contentType: "text/css; charset=utf-8", discovered: sameSitePathsFromCss(css, url, origin), optional: [] };
  }
  if (ext === "js" || ext === "mjs") {
    const rewrite = makeOriginRewriter(origin);
    const js = rewrite(buffer.toString("utf8"));
    const discovered: string[][] = [];
    for (const m of js.matchAll(JS_WP_PATH_RE)) {
      const segs = assetPathFromRef(m[1]);
      if (segs) discovered.push(segs);
    }
    return { ok: true, buffer: Buffer.from(js, "utf8"), contentType: "text/javascript; charset=utf-8", discovered, optional: harvestLazyAssets(path, js) };
  }
  return { ok: true, buffer, contentType, discovered: [], optional: [] };
}

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

/**
 * Uploads a fetched file (content-addressed per job, so the same bytes referenced under
 * several paths upload once) and registers it as a TemplateAsset on the page that owns its
 * path. .put() rather than .create(): a retried step re-registering the same path must
 * overwrite, not fail.
 */
export async function storeMigratedAsset(
  jobId: string,
  ownerTemplateId: string,
  relPath: string,
  buffer: Buffer,
  contentType: string,
): Promise<{ blobUrl: string; size: number }> {
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  let blobUrl: string;
  const { data: existing } = await SiteImportAssetBlob.get({ jobId, sha256 }).go();
  if (existing) {
    blobUrl = existing.blobUrl;
  } else {
    const ext = extensionOf(relPath) || "bin";
    const blob = await uploadObject(`wp-migration/${jobId}/${sha256}.${ext}`, buffer, { access: "public", contentType });
    blobUrl = blob.url;
    try {
      await SiteImportAssetBlob.create({ id: randomUUID(), jobId, sha256, blobUrl, contentType, size: buffer.byteLength }).go();
    } catch (err) {
      if (!isConditionalCheckFailure(err)) throw err;
    }
  }
  await TemplateAsset.put({ id: randomUUID(), templateId: ownerTemplateId, path: relPath, blobUrl, contentType, size: buffer.byteLength }).go();
  return { blobUrl, size: buffer.byteLength };
}
