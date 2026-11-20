import type { SectionField } from "./model";

type Content = Record<string, unknown>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const stripKeys = (v: unknown): unknown => (Array.isArray(v) ? v.map(stripKeys) : isObj(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "_key").map(([k, x]) => [k, stripKeys(x)])) : v);

/**
 * Turns "here is the whole form" into the smallest change: a field that changed becomes one change; a repeated group of
 * the same length changes cell by cell (so each row keeps its identity and any per-row tweaks); a group that grew, shrank or
 * was reordered is sent whole. Pure.
 */
export function contentPatch(fields: SectionField[], before: Content, after: Content): Content {
  const patch: Content = {};
  for (const f of fields) {
    const a = after[f.key];
    const b = before[f.key];
    if (a === undefined || same(stripKeys(a), stripKeys(b))) continue;
    if (f.type === "list" && Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      a.forEach((row, i) => {
        if (!isObj(row) || !isObj(b[i])) { patch[`${f.key}.${i}`] = stripKeys(row); return; }
        for (const inner of f.item ?? []) {
          if (row[inner.key] !== undefined && !same(row[inner.key], (b[i] as Content)[inner.key])) patch[`${f.key}.${i}.${inner.key}`] = row[inner.key];
        }
      });
    } else patch[f.key] = f.type === "list" ? stripKeys(a) : a;
  }
  return patch;
}

