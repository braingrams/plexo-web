/**
 * Resolves the bytes of one Plexo logo kind: the current Strata asset when there is one and it
 * passes every check, otherwise the bundled file. Used by the public logo proxy
 * (app/api/brand/logo/[kind]), the favicon routes and the receipt PDF. Never throws.
 */
import { createHash } from "node:crypto";
import { FALLBACK_LOGO_FILES } from "./fallbackAssets";
import { getPlexoBrand } from "./plexoBrand";
import { BITMAP_ONLY, isAllowedLogoUrl, type LogoKind } from "./strataTokens";

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/svg+xml", "image/png", "image/jpeg", "image/webp"]);
const FRESH_MS = 5 * 60_000;
const STALE_MS = 24 * 3600_000;
const TIMEOUT_MS = 3_000;

export type LogoBytes = { bytes: Uint8Array; contentType: string; etag: string; source: "strata" | "fallback" };

const FIELD: Record<LogoKind, "wordmarkOnLight" | "wordmarkOnDark" | "emailOnLight" | "emailOnDark" | "icon" | "appIcon"> = {
  "wordmark-on-light": "wordmarkOnLight",
  "wordmark-on-dark": "wordmarkOnDark",
  "email-on-light": "emailOnLight",
  "email-on-dark": "emailOnDark",
  icon: "icon",
  "app-icon": "appIcon",
};

const etagOf = (b: Uint8Array) => `"${createHash("sha1").update(b).digest("hex").slice(0, 20)}"`;

export function bundledLogo(kind: LogoKind): LogoBytes {
  const f = FALLBACK_LOGO_FILES[kind];
  const bytes = new Uint8Array(Buffer.from(f.base64, "base64"));
  return { bytes, contentType: f.contentType, etag: etagOf(bytes), source: "fallback" };
}

/** SVGs are only ever shown through <img>, but anything scripted is refused outright. */
export function svgLooksSafe(text: string): boolean {
  return /<svg[\s>]/i.test(text) && !/<script|<foreignObject|<iframe|<embed|<object|javascript:|\son[a-z]+\s*=|<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text);
}

async function readCapped(res: Response): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_LOGO_BYTES || !res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_LOGO_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function fetchStrataAsset(kind: LogoKind, url: string): Promise<LogoBytes | null> {
  if (!isAllowedLogoUrl(url)) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok || !isAllowedLogoUrl(res.url || url)) return null;
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(contentType)) return null;
  if (BITMAP_ONLY.has(kind) && contentType === "image/svg+xml") return null;
  const bytes = await readCapped(res);
  if (!bytes || bytes.byteLength === 0) return null;
  if (contentType === "image/svg+xml" && !svgLooksSafe(new TextDecoder().decode(bytes))) return null;
  return { bytes, contentType, etag: etagOf(bytes), source: "strata" };
}

const cache = new Map<string, { url: string; value: LogoBytes; at: number }>();
export function __clearLogoCacheForTests() {
  cache.clear();
}

export async function getPlexoLogo(kind: LogoKind): Promise<LogoBytes> {
  try {
    const url = (await getPlexoBrand()).logos[FIELD[kind]];
    if (!url) return bundledLogo(kind);
    const hit = cache.get(kind);
    if (hit && hit.url === url && Date.now() - hit.at < FRESH_MS) return hit.value;
    try {
      const fresh = await fetchStrataAsset(kind, url);
      if (fresh) {
        cache.set(kind, { url, value: fresh, at: Date.now() });
        return fresh;
      }
    } catch {
      // fall through to a stale copy, then the bundled file
    }
    if (hit && hit.url === url && Date.now() - hit.at < STALE_MS) return hit.value;
  } catch {
    // fall through
  }
  return bundledLogo(kind);
}
