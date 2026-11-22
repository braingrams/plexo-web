import { createHash } from "node:crypto";
import { ImageDimension } from "@/lib/db/opsEntities";
import { safeFetch } from "@/lib/siteImport/fetchSafe";

/**
 * Picture sizes, so a page can reserve the right space before a picture arrives (no jumping).
 *
 * Where the size comes from, in order:
 *  1. Pictures uploaded to Plexo: read from the file itself at upload time (recordUploadedSize).
 *  2. Everything else (pictures linked from other sites, older uploads): looked up ONCE when the owner switches the fix on,
 *     and again by the background re-check for new pictures. The lookup reads only the first 256 KB of the file, through
 *     the same address-safety checks as site import (never an internal address), with a short timeout, and remembers
 *     the answer for 180 days (and "could not be read" for a week, so a dead link is not retried on every check).
 * Serving a page never fetches anything: it only reads remembered sizes.
 */

export type Size = { width: number; height: number };

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 5000;
const MAX_PIXELS = 20000;
const PROBE_CONCURRENCY = 4;
export const MAX_PROBES_PER_RUN = 60;
const FAILED_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

const sane = (w: number, h: number): Size | null => (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= MAX_PIXELS && h <= MAX_PIXELS ? { width: w, height: h } : null);

/** Reads the width and height out of the first bytes of a PNG, JPEG, GIF, WebP, AVIF or SVG file. Null when it is not one of those. */
export function readImageSize(buf: Uint8Array): Size | null {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length < 12) return null;
  // PNG
  if (b.readUInt32BE(0) === 0x89504e47 && b.length >= 24) return sane(b.readUInt32BE(16), b.readUInt32BE(20));
  // GIF
  if (b.toString("latin1", 0, 3) === "GIF" && b.length >= 10) return sane(b.readUInt16LE(6), b.readUInt16LE(8));
  // WebP
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" && b.length >= 30) {
    const kind = b.toString("latin1", 12, 16);
    if (kind === "VP8 ") return sane(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
    if (kind === "VP8L") {
      const bits = b.readUInt32LE(21);
      return sane((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    if (kind === "VP8X") return sane(1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16)));
    return null;
  }
  // JPEG: walk the segments to the first "start of frame". EXIF rotation of 90 degrees swaps the sides.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let swap = false;
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const len = b.readUInt16BE(i + 2);
      if (marker === 0xe1 && b.toString("latin1", i + 4, i + 8) === "Exif") swap = exifRotates(b.subarray(i + 10, i + 2 + len));
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const h = b.readUInt16BE(i + 5);
        const w = b.readUInt16BE(i + 7);
        return swap ? sane(h, w) : sane(w, h);
      }
      i += 2 + len;
    }
    return null;
  }
  // AVIF / HEIF: the "ispe" box holds the picture size.
  if (b.toString("latin1", 4, 8) === "ftyp") {
    const at = b.indexOf("ispe", 0, "latin1");
    if (at !== -1 && at + 16 <= b.length) return sane(b.readUInt32BE(at + 8), b.readUInt32BE(at + 12));
    return null;
  }
  // SVG
  const head = b.toString("utf8", 0, Math.min(b.length, 4096));
  if (/<svg\b/i.test(head)) return svgSize(head);
  return null;
}

/** True when the EXIF "orientation" says the picture is turned on its side (5 to 8). */
function exifRotates(tiff: Buffer): boolean {
  try {
    if (tiff.length < 14) return false;
    const little = tiff.toString("latin1", 0, 2) === "II";
    const u16 = (o: number) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
    const u32 = (o: number) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
    const ifd = u32(4);
    const count = u16(ifd);
    for (let n = 0; n < count && ifd + 2 + n * 12 + 12 <= tiff.length; n++) {
      const o = ifd + 2 + n * 12;
      if (u16(o) === 0x0112) return u16(o + 8) >= 5 && u16(o + 8) <= 8;
    }
  } catch {
    // unreadable EXIF: assume upright
  }
  return false;
}

function svgSize(head: string): Size | null {
  const tag = head.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const num = (name: string) => {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(px)?\\s*["']`, "i"));
    return m ? Math.round(parseFloat(m[1])) : null;
  };
  const w = num("width");
  const h = num("height");
  if (w && h) return sane(w, h);
  const vb = tag.match(/\bviewBox\s*=\s*["']\s*[-0-9.]+[ ,]+[-0-9.]+[ ,]+([0-9.]+)[ ,]+([0-9.]+)\s*["']/i);
  return vb ? sane(Math.round(parseFloat(vb[1])), Math.round(parseFloat(vb[2]))) : null;
}

export const imageKey = (url: string) => createHash("sha1").update(url).digest("hex");

/** The real picture address behind a src: unwraps Plexo's resizer (/_next/image?url=...), keeps only public https/http. */
export function originalImageUrl(src: string, base?: string): string | null {
  try {
    const u = new URL(src, base ?? "https://x.invalid");
    if (u.pathname === "/_next/image") {
      const inner = u.searchParams.get("url");
      return inner ? originalImageUrl(inner, base) : null;
    }
    if (u.hostname === "x.invalid") return null; // relative with no base: cannot be looked up
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Remembers the size of a picture the owner just uploaded to Plexo. Never throws: an upload must not fail because of this. */
export async function recordUploadedSize(url: string, file: Uint8Array): Promise<Size | null> {
  try {
    const size = readImageSize(file);
    if (!size) return null;
    await ImageDimension.upsert({ key: imageKey(url), url, width: size.width, height: size.height, source: "upload", failed: false }).go();
    memory.set(url, { size, at: Date.now() });
    return size;
  } catch (err) {
    console.error("image size not saved:", err instanceof Error ? err.message : "unknown error");
    return null;
  }
}

/** Reads a picture's size from the first bytes of the file it points to. Null when it cannot be read. */
export async function probeImageSize(url: string): Promise<Size | null> {
  try {
    const res = await safeFetch(url, { headers: { Range: `bytes=0-${MAX_BYTES - 1}`, Accept: "image/*" }, signal: AbortSignal.timeout(TIMEOUT_MS), maxRedirects: 3 });
    if (!res.ok || !res.body) return null;
    const type = res.headers.get("content-type") ?? "";
    if (type && !/^image\//i.test(type) && !/octet-stream/i.test(type)) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
      // Enough to know the size for most files: stop early instead of downloading the whole picture.
      if (total >= 32 * 1024) {
        const so = readImageSize(Buffer.concat(chunks));
        if (so) {
          await reader.cancel().catch(() => undefined);
          return so;
        }
      }
    }
    await reader.cancel().catch(() => undefined);
    return readImageSize(Buffer.concat(chunks));
  } catch {
    return null;
  }
}

const MEMORY_TTL_MS = 5 * 60 * 1000;
const memory = new Map<string, { size: Size | null; at: number }>();

/** Remembered sizes for these addresses. Pictures with no remembered size are simply missing from the answer. */
export async function sizesFor(urls: string[]): Promise<Map<string, Size>> {
  const out = new Map<string, Size>();
  const need: string[] = [];
  for (const u of new Set(urls)) {
    const hit = memory.get(u);
    if (hit && Date.now() - hit.at < MEMORY_TTL_MS) {
      if (hit.size) out.set(u, hit.size);
    } else need.push(u);
  }
  if (need.length) {
    try {
      for (let i = 0; i < need.length; i += 90) {
        const slice = need.slice(i, i + 90);
        const { data } = await ImageDimension.get(slice.map((url) => ({ key: imageKey(url) }))).go();
        const byKey = new Map(data.map((r) => [r.key, r]));
        for (const url of slice) {
          const row = byKey.get(imageKey(url));
          const size = row && !row.failed && row.width && row.height ? { width: row.width, height: row.height } : null;
          memory.set(url, { size, at: Date.now() });
          if (size) out.set(url, size);
        }
      }
    } catch (err) {
      console.error("image sizes not read:", err instanceof Error ? err.message : "unknown error");
    }
  }
  if (memory.size > 20000) memory.delete(memory.keys().next().value!);
  return out;
}

/**
 * Looks up, once, the pictures we do not know the size of yet. Returns how many are known afterwards.
 * Limits: MAX_PROBES_PER_RUN lookups per call, PROBE_CONCURRENCY at a time, and addresses that failed less than a week ago are skipped.
 */
export async function learnSizes(urls: string[], opts: { deadlineMs?: number } = {}): Promise<{ known: number; probed: number; unreadable: number }> {
  const stopAt = Date.now() + (opts.deadlineMs ?? 30_000);
  const unique = [...new Set(urls)];
  const known = await sizesFor(unique);
  let rows: Map<string, { failed?: boolean; checkedAt?: string }> = new Map();
  try {
    const missing = unique.filter((u) => !known.has(u));
    const { data } = missing.length ? await ImageDimension.get(missing.map((url) => ({ key: imageKey(url) }))).go() : { data: [] };
    rows = new Map(data.map((r) => [r.key, r]));
  } catch {
    rows = new Map();
  }
  const todo = unique.filter((u) => {
    if (known.has(u)) return false;
    const r = rows.get(imageKey(u));
    return !(r?.failed && r.checkedAt && Date.now() - new Date(r.checkedAt).getTime() < FAILED_RETRY_MS);
  }).slice(0, MAX_PROBES_PER_RUN);
  let probed = 0;
  let unreadable = 0;
  for (let i = 0; i < todo.length && Date.now() < stopAt; i += PROBE_CONCURRENCY) {
    await Promise.all(
      todo.slice(i, i + PROBE_CONCURRENCY).map(async (url) => {
        const size = await probeImageSize(url);
        probed++;
        if (!size) unreadable++;
        try {
          await ImageDimension.upsert({ key: imageKey(url), url, width: size?.width, height: size?.height, source: "probe", failed: !size }).go();
        } catch {
          // not saved: it will be looked up again next time
        }
        memory.set(url, { size, at: Date.now() });
        if (size) known.set(url, size);
      }),
    );
  }
  return { known: known.size, probed, unreadable };
}

/** Pure: the picture addresses used by the <img> tags of a page that need a size (no width/height of their own). */
export function imagesNeedingSize(html: string, base?: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = m[1];
    if (hasBothSizes(attrs)) continue;
    const sm = attrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const src = sm?.[1] ?? sm?.[2];
    const url = src ? originalImageUrl(src, base) : null;
    if (url) out.push(url);
  }
  return out;
}

export const hasBothSizes = (attrs: string) => /\bwidth\s*=\s*["']?\d/i.test(attrs) && /\bheight\s*=\s*["']?\d/i.test(attrs);
