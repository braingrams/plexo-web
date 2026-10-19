import { gunzipSync } from "node:zlib";

// Cleanup for big values kept in storage (lib/db/largeValues.ts: private/db-values/<hash>) and big brands
// (lib/v2/designSystemStore.ts: private/design-systems/<hash>.json.gz). Both are content-addressed and never changed or deleted by a
// save, so an edit that replaces a big value leaves the old one behind. This finds what no row points at any more and removes it.
//
// Safety, in order of importance:
//  - It only deletes after reading EVERY row of EVERY table without a single error; any doubt and it deletes nothing.
//  - Only objects older than the grace period are considered, and every save re-writes (so refreshes) what it points at, so
//    nothing a row got to reference in the last week can be removed while that row is being read.
//  - A value is "in use" if a row holds its marker, OR a stored value / packed design that is itself in use mentions it
//    (a big page can hold a brand reference, and that page may itself be stored as a big value).
//  - Dry run unless told otherwise.

export const GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const MARKER = /plx-value:v1:([a-f0-9]{64}):\d+/g;
const BRAND_REF = /"designSystemRef"\s*:\s*\{[^}]*?"hash"\s*:\s*"([a-f0-9]{64})"/g;
const WHOLE_MARKER = /^plx-value:v1:([a-f0-9]{64}):\d+$/;

export interface SweepStore {
  /** Stored objects under a prefix. */
  list(prefix: string): AsyncIterable<{ key: string; lastModified: Date }>;
  /** The stored text of a big value (gunzipped), or null when it's gone. */
  readValue(hash: string): Promise<string | null>;
  delete(keys: string[]): Promise<void>;
}

export type SweepReport = {
  rows: number;
  inUseValues: number;
  inUseBrands: number;
  storedValues: number;
  storedBrands: number;
  staleValues: number;
  staleBrands: number;
  deleted: number;
  dryRun: boolean;
};

export const VALUE_PREFIX = "private/db-values/";
export const BRAND_PREFIX = "private/design-systems/";

/** Every string anywhere inside a stored row (rows come back as plain objects from a scan). */
function* strings(node: unknown): Generator<string> {
  if (typeof node === "string") yield node;
  else if (Array.isArray(node)) for (const n of node) yield* strings(n);
  else if (node && typeof node === "object") for (const v of Object.values(node)) yield* strings(v);
}

/** The text a long stored string stands for: a gzipped, base64 design (what lib/db/packed.ts writes) or just itself. */
function decodePacked(text: string): string[] {
  const out = [text];
  if (text.length >= 40 && !text.includes(" ") && !text.startsWith("gz1:")) {
    try {
      out.push(gunzipSync(Buffer.from(text, "base64")).toString("utf8"));
    } catch {
      /* not a packed design */
    }
  }
  return out;
}

export async function sweepStoredValues(opts: {
  /** Every row of every table, as plain objects, WITHOUT the big-value layer (so markers are seen as markers). Must throw on any failure. */
  rows: () => AsyncIterable<Record<string, unknown>>;
  store: SweepStore;
  apply: boolean;
  now?: number;
  graceMs?: number;
}): Promise<SweepReport> {
  const now = opts.now ?? Date.now();
  const graceMs = opts.graceMs ?? GRACE_MS;
  const values = new Set<string>();
  const brands = new Set<string>();
  let rows = 0;

  const inspect = async (text: string, depth = 0): Promise<void> => {
    if (depth > 4) return;
    const whole = WHOLE_MARKER.exec(text);
    if (whole) {
      const hash = whole[1];
      if (values.has(hash)) return;
      values.add(hash);
      const stored = await opts.store.readValue(hash); // a stored value can itself hold a marker or a brand reference
      if (stored) await inspect(stored, depth + 1);
      return;
    }
    for (const candidate of decodePacked(text)) {
      for (const m of candidate.matchAll(BRAND_REF)) brands.add(m[1]);
      for (const m of candidate.matchAll(MARKER)) {
        if (!values.has(m[1])) await inspect(`plx-value:v1:${m[1]}:0`, depth + 1);
      }
    }
  };

  for await (const row of opts.rows()) {
    rows++;
    for (const text of strings(row)) {
      if (text.length < 40) continue;
      await inspect(text);
    }
  }

  const classify = async (prefix: string, live: Set<string>) => {
    const all: Array<{ key: string; hash: string }> = [];
    const stale: string[] = [];
    for await (const o of opts.store.list(prefix)) {
      const hash = /([a-f0-9]{64})(?:\.json\.gz)?$/.exec(o.key)?.[1];
      if (!hash) continue;
      all.push({ key: o.key, hash });
      if (!live.has(hash) && now - o.lastModified.getTime() > graceMs) stale.push(o.key);
    }
    return { total: all.length, stale };
  };
  const v = await classify(VALUE_PREFIX, values);
  const b = await classify(BRAND_PREFIX, brands);

  let deleted = 0;
  if (opts.apply) {
    for (const keys of [v.stale, b.stale]) {
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        await opts.store.delete(batch);
        deleted += batch.length;
      }
    }
  }
  return { rows, inUseValues: values.size, inUseBrands: brands.size, storedValues: v.total, storedBrands: b.total, staleValues: v.stale.length, staleBrands: b.stale.length, deleted, dryRun: !opts.apply };
}
