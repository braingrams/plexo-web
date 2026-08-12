import JSZip from "jszip";
import mime from "mime";

// This is deliberately NOT a content sanitizer — raw-upload pages are served verbatim,
// unsanitized HTML/CSS/JS by design (see prisma/schema.prisma's TemplateSourceType doc
// comment for why that's safe: isolation, not content filtering, is the boundary).
// What this file guards against is platform abuse, not page content:
//   - zip-slip path traversal escaping the extraction root
//   - decompression bombs (huge uncompressed payloads from a tiny zip)
//   - uploading server-executable file types onto what is meant to be static hosting
export const MAX_TOTAL_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB per site
export const MAX_SINGLE_FILE_BYTES = 1 * 1024 * 1024; // 1MB per individual file — zip entry, single-file upload, or an edit-save
export const MAX_FILE_COUNT = 500;

const ALLOWED_EXTENSIONS = new Set([
  "html", "htm", "css", "js", "mjs", "json", "txt", "xml", "map", "webmanifest",
  "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico",
  "woff", "woff2", "ttf", "otf", "eot",
]);

// Text-editable in the dashboard's raw-file editor — everything else (images, fonts)
// is view/reference-only, since a binary file has no meaningful "edit as text" action.
const TEXT_EXTENSIONS = new Set(["html", "htm", "css", "js", "mjs", "json", "txt", "xml", "svg", "webmanifest"]);

export function isEditableExtension(path: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(path));
}

export function isAllowedExtension(path: string): boolean {
  return ALLOWED_EXTENSIONS.has(extensionOf(path));
}

// Minimal starter content per extension so a newly-added file isn't just a blank blob —
// mirrors what someone would actually type first in a new .css/.js file.
export function starterContentFor(path: string): string {
  switch (extensionOf(path)) {
    case "css":
      return "/* " + path + " */\n";
    case "js":
    case "mjs":
      return "// " + path + "\n";
    case "json":
    case "webmanifest":
      return "{}\n";
    default:
      return "";
  }
}

export class RawUploadValidationError extends Error {}

export type ExtractedAsset = {
  path: string; // relative, forward-slash, no leading "./" or "/"
  buffer: Buffer;
  contentType: string;
};

export type ExtractedSite = {
  indexHtml: string; // root document content (utf8)
  assets: ExtractedAsset[]; // everything else (css/js/images/fonts/sub-pages)
};

function normalizeZipPath(rawPath: string): string {
  // Strip a single common wrapping folder some zip tools add (e.g. "my-site/index.html"
  // -> "index.html") so "right click > compress" exports still work without the user
  // needing to know to zip file contents rather than the folder itself.
  return rawPath.replace(/^\.?\//, "");
}

export function extensionOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? "" : path.slice(idx + 1).toLowerCase();
}

export function contentTypeFor(path: string): string {
  return mime.getType(path) || "application/octet-stream";
}

/**
 * Turns an extra root-level HTML filename from a zip upload into a human page name — e.g.
 * "about-us.html" -> "About Us". Used only when auto-splitting a multi-page zip upload into
 * separate Template pages (see upload-raw/route.ts) — the resulting name is always editable
 * afterward via rename, so this just needs to be a reasonable starting guess.
 */
export function humanizePageFilename(path: string): string {
  const base = path.replace(/\.(html?|htm)$/i, "").replace(/[-_]+/g, " ").trim();
  if (!base) return "Page";
  return base
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function validateSingleHtmlUpload(filename: string, buffer: Buffer): ExtractedSite {
  const ext = extensionOf(filename);
  if (ext !== "html" && ext !== "htm") {
    throw new RawUploadValidationError("Only .html/.htm or .zip files are supported.");
  }
  if (buffer.byteLength > MAX_SINGLE_FILE_BYTES) {
    throw new RawUploadValidationError(
      `File exceeds the ${MAX_SINGLE_FILE_BYTES / 1024 / 1024}MB per-file limit.`
    );
  }
  return { indexHtml: buffer.toString("utf8"), assets: [] };
}

/**
 * Same validation as validateSingleHtmlUpload, but for HTML supplied inline as a string
 * (an MCP tool's htmlContent argument, or a JSON request body) instead of an uploaded
 * File — there's no zip/multi-file equivalent for this path, single self-contained
 * documents only.
 */
export function validateRawHtmlContent(html: string): void {
  if (typeof html !== "string" || html.trim().length === 0) {
    throw new RawUploadValidationError("htmlContent is required and cannot be empty.");
  }
  const byteLength = Buffer.byteLength(html, "utf8");
  if (byteLength > MAX_SINGLE_FILE_BYTES) {
    throw new RawUploadValidationError(
      `htmlContent exceeds the ${MAX_SINGLE_FILE_BYTES / 1024 / 1024}MB per-page limit.`
    );
  }
}

// Per-account cap on RAW_UPLOAD template creation via any path (dashboard upload, REST
// JSON body, or MCP tools) — a plain DB count query rather than a dedicated rate-limit
// store, since there's no Redis/Upstash in this stack yet. Fine at current scale; swap
// for a token-bucket in Upstash if raw uploads get high-volume.
export const RAW_UPLOAD_DAILY_LIMIT = 15;

export async function extractZipUpload(buffer: Buffer): Promise<ExtractedSite> {
  if (buffer.byteLength > MAX_TOTAL_UPLOAD_BYTES) {
    throw new RawUploadValidationError(
      `Zip exceeds the ${MAX_TOTAL_UPLOAD_BYTES / 1024 / 1024}MB upload limit.`
    );
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new RawUploadValidationError("Could not read the uploaded file as a zip archive.");
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length === 0) {
    throw new RawUploadValidationError("Zip archive is empty.");
  }
  if (entries.length > MAX_FILE_COUNT) {
    throw new RawUploadValidationError(`Zip contains too many files (max ${MAX_FILE_COUNT}).`);
  }

  const files = new Map<string, Buffer>();
  let totalBytes = 0;

  for (const entry of entries) {
    const normalized = normalizeZipPath(entry.name);

    // zip-slip guard: reject any entry whose normalized path escapes the extraction
    // root (parent-directory traversal or an absolute path).
    if (normalized.includes("..") || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
      throw new RawUploadValidationError(`Unsafe file path in zip: "${entry.name}".`);
    }

    const ext = extensionOf(normalized);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new RawUploadValidationError(
        `File type ".${ext || "(none)"}" is not allowed (${entry.name}). This is a static-page host — ` +
        `only HTML/CSS/JS and common asset types are accepted.`
      );
    }

    const content = await entry.async("nodebuffer");
    if (content.byteLength > MAX_SINGLE_FILE_BYTES) {
      throw new RawUploadValidationError(
        `"${entry.name}" exceeds the ${MAX_SINGLE_FILE_BYTES / 1024 / 1024}MB per-file limit.`
      );
    }
    totalBytes += content.byteLength;
    if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
      // Guards decompression bombs: a tiny zip that inflates far past the declared
      // buffer size is caught here as soon as the running total crosses the limit,
      // not after fully decompressing an arbitrarily large payload.
      throw new RawUploadValidationError(
        `Zip contents exceed the ${MAX_TOTAL_UPLOAD_BYTES / 1024 / 1024}MB uncompressed limit.`
      );
    }

    files.set(normalized, content);
  }

  const indexPath = ["index.html", "index.htm"].find((p) => files.has(p));
  if (!indexPath) {
    throw new RawUploadValidationError(
      "Zip must contain an index.html (or index.htm) at its root."
    );
  }

  const indexHtml = files.get(indexPath)!.toString("utf8");
  files.delete(indexPath);

  const assets: ExtractedAsset[] = Array.from(files.entries()).map(([path, contentBuf]) => ({
    path,
    buffer: contentBuf,
    contentType: contentTypeFor(path),
  }));

  return { indexHtml, assets };
}

// Cheap, dependency-free extraction of outbound http(s) links referenced by the page —
// used to feed the async Safe Browsing scan (lib/safeBrowsing.ts). Not a parser; just
// enough to catch href/src/action targets for abuse screening, not to sanitize anything.
export function extractOutboundUrls(html: string): string[] {
  const urls = new Set<string>();
  const attrPattern = /\b(?:href|src|action)\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(html)) !== null) {
    urls.add(match[1]);
  }
  return Array.from(urls).slice(0, 100); // cap — this only feeds a scan, not a security boundary
}
