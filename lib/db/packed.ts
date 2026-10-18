import { gunzipSync, gzipSync } from "node:zlib";

// A DynamoDB item is capped at 400 KB. A V2 page row carries the live design, the draft design
// and both compiled documents, and a page with a customised design system is ~170 KB of
// JSON per copy — so the big values are stored gzipped and unpacked again on every read. The
// packing lives at the entity boundary (lib/db/contentEntities.ts set/get), so no caller ever
// sees a packed value. Small values are stored as they are, which keeps small rows readable
// in the console and rows written before this existed untouched.

const MIN_PACK_CHARS = 16_000;
const HTML_PREFIX = "gz1:";

type PackedJson = { __packed: "gz1"; format?: unknown; data: string };

const isPackedJson = (v: unknown): v is PackedJson =>
  !!v && typeof v === "object" && (v as { __packed?: unknown }).__packed === "gz1" && typeof (v as { data?: unknown }).data === "string";

export function packJson<T>(value: T): T | PackedJson {
  if (value === null || typeof value !== "object") return value;
  const json = JSON.stringify(value);
  if (json.length < MIN_PACK_CHARS) return value;
  // `format` stays readable outside the pack so a row can still be told apart without unpacking.
  const format = (value as { format?: unknown }).format;
  return { __packed: "gz1", ...(format !== undefined ? { format } : {}), data: gzipSync(json).toString("base64") };
}

export function unpackJson<T>(value: T): T {
  if (!isPackedJson(value)) return value;
  return JSON.parse(gunzipSync(Buffer.from(value.data, "base64")).toString("utf8")) as T;
}

export function packHtml(value: string | undefined | null): string | undefined | null {
  if (typeof value !== "string" || value.length < MIN_PACK_CHARS) return value;
  return HTML_PREFIX + gzipSync(value).toString("base64");
}

export function unpackHtml(value: string | undefined | null): string | undefined | null {
  if (typeof value !== "string" || !value.startsWith(HTML_PREFIX)) return value;
  return gunzipSync(Buffer.from(value.slice(HTML_PREFIX.length), "base64")).toString("utf8");
}
