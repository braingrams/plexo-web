// Row-by-row edits for the AI tools: "add a testimonial", "remove the third team member", "move row 2 up". Pure.

export type RowOps = {
  content?: unknown;
  addRows?: { field?: unknown; rows?: unknown; at?: unknown };
  removeRows?: { field?: unknown; indexes?: unknown };
  moveRow?: { field?: unknown; from?: unknown; to?: unknown };
  duplicateRow?: { field?: unknown; index?: unknown };
};

type Content = Record<string, unknown>;
type Field = { key: string; label: string; type: string; limit?: number; itemName?: string; item?: Field[] };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function setPath(root: Content, path: string, value: unknown): string | null {
  const parts = path.split(".").filter(Boolean);
  let cur: unknown = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (Array.isArray(cur) && /^\d+$/.test(p)) cur = cur[Number(p)];
    else if (isObj(cur)) cur = cur[p];
    else return `"${path}" doesn't point at anything in this section.`;
    if (cur === undefined || cur === null) return `"${path}" doesn't point at anything in this section (row numbers start at 0).`;
  }
  const last = parts[parts.length - 1];
  if (Array.isArray(cur) && /^\d+$/.test(last)) cur[Number(last)] = value;
  else if (isObj(cur)) cur[last] = value;
  else return `"${path}" doesn't point at anything in this section.`;
  return null;
}

/** Applies the changes to a copy of `content`; returns it, or a plain-words problem. */
export function applyRowOps(fields: Field[], content: Content, ops: RowOps): { value: Content } | { error: string } {
  const out = clone(content);
  const listField = (name: unknown): Field | string => {
    const f = fields.find((x) => x.type === "list" && (x.key === name || x.label.toLowerCase() === String(name).toLowerCase()));
    return f ?? `There's no repeating group called "${String(name)}". Available: ${fields.filter((x) => x.type === "list").map((x) => x.key).join(", ") || "none in this section"}.`;
  };
  const rowsOf = (f: Field): unknown[] => (Array.isArray(out[f.key]) ? (out[f.key] as unknown[]) : (out[f.key] = []) as unknown[]);
  const within = (n: unknown, len: number): number | null => (Number.isInteger(n) && (n as number) >= 0 && (n as number) < len ? (n as number) : null);

  if (ops.content !== undefined) {
    if (!isObj(ops.content)) return { error: "content should be an object like {heading: 'New'}." };
    for (const [k, v] of Object.entries(ops.content)) {
      const problem = k.includes(".") ? setPath(out, k, v) : (out[k] = v, null);
      if (problem) return { error: problem };
    }
  }
  if (ops.addRows) {
    const f = listField(ops.addRows.field);
    if (typeof f === "string") return { error: f };
    const rows = Array.isArray(ops.addRows.rows) ? ops.addRows.rows.filter(isObj) : [];
    if (!rows.length) return { error: `addRows needs rows: [{…}] — one object per ${f.itemName ?? "row"}.` };
    const list = rowsOf(f);
    if (f.limit && list.length + rows.length > f.limit) return { error: `"${f.label}" can have at most ${f.limit}. It has ${list.length} now.` };
    const at = Number.isInteger(ops.addRows.at) ? Math.max(0, Math.min(list.length, ops.addRows.at as number)) : list.length;
    list.splice(at, 0, ...rows.map(clone));
  }
  if (ops.removeRows) {
    const f = listField(ops.removeRows.field);
    if (typeof f === "string") return { error: f };
    const list = rowsOf(f);
    const idx = Array.isArray(ops.removeRows.indexes) ? ops.removeRows.indexes : [];
    if (!idx.length || idx.some((i) => within(i, list.length) === null)) return { error: `removeRows needs indexes between 0 and ${Math.max(0, list.length - 1)} (rows count from 0).` };
    const drop = new Set(idx as number[]);
    out[f.key] = list.filter((_, i) => !drop.has(i));
  }
  if (ops.moveRow) {
    const f = listField(ops.moveRow.field);
    if (typeof f === "string") return { error: f };
    const list = rowsOf(f);
    const from = within(ops.moveRow.from, list.length);
    const to = within(ops.moveRow.to, list.length);
    if (from === null || to === null) return { error: `moveRow needs from and to between 0 and ${Math.max(0, list.length - 1)}.` };
    const [it] = list.splice(from, 1);
    list.splice(to, 0, it);
  }
  if (ops.duplicateRow) {
    const f = listField(ops.duplicateRow.field);
    if (typeof f === "string") return { error: f };
    const list = rowsOf(f);
    const i = within(ops.duplicateRow.index, list.length);
    if (i === null) return { error: `duplicateRow needs an index between 0 and ${Math.max(0, list.length - 1)}.` };
    if (f.limit && list.length + 1 > f.limit) return { error: `"${f.label}" can have at most ${f.limit}.` };
    const { _key: _drop, ...copy } = (list[i] ?? {}) as Record<string, unknown>;
    void _drop;
    list.splice(i + 1, 0, clone(copy));
  }
  return { value: out };
}
