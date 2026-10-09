import type { SchemaInfo, TableInfo, ColumnInfo, ForeignKey } from "./schema";

// Compiles a query from the app's client (src/lib/plexo.ts: plexo.from("todos").select()…)
// into ONE parameterized SQL statement. Semantics follow PostgREST/Supabase, so code an AI
// (or a developer) writes from Supabase habits works unchanged.
//
// Safety: every table, column and relation name is checked against the app's real schema
// and quoted; every value is a bound parameter cast to its column's type. Nothing from the
// request is ever spliced into SQL text. Row access is then decided by Postgres RLS, since
// the statement runs as plexo_anon / plexo_authenticated.

export class RestError extends Error {
  constructor(message: string, public readonly status = 400, public readonly hint?: string) {
    super(message);
  }
}

export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "in" | "is" | "contains" | "containedBy" | "overlaps" | "textSearch";
export type Filter = { column: string; op: FilterOp; value: unknown; negate?: boolean };
export type Order = { column: string; ascending: boolean; nullsFirst?: boolean; foreignTable?: string };

export type QueryState = {
  table: string;
  action: "select" | "insert" | "update" | "upsert" | "delete";
  columns?: string;
  filters?: Filter[];
  or?: string[];
  order?: Order[];
  limit?: number;
  offset?: number;
  count?: "exact";
  head?: boolean;
  single?: "single" | "maybeSingle";
  values?: unknown;
  onConflict?: string;
  ignoreDuplicates?: boolean;
  returning?: boolean;
};

export type Compiled = {
  sql: string;
  params: unknown[];
  /** "json": one row { data, count }. "rowCount": a plain write, report rows affected. */
  mode: "json" | "rowCount";
  single?: "single" | "maybeSingle";
};

export const MAX_ROWS = 1000;
const OPS: Record<string, FilterOp> = {
  eq: "eq", neq: "neq", gt: "gt", gte: "gte", lt: "lt", lte: "lte", like: "like", ilike: "ilike", in: "in", is: "is",
  cs: "contains", cd: "containedBy", ov: "overlaps", fts: "textSearch", plfts: "textSearch", phfts: "textSearch", wfts: "textSearch",
  contains: "contains", containedBy: "containedBy", overlaps: "overlaps", textSearch: "textSearch",
};

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

// ---------------------------------------------------------------- select parsing

export type SelectItem =
  | { kind: "star" }
  | { kind: "column"; column: string; path: string[]; arrow: Array<"->" | "->>">; alias: string; cast?: string }
  | { kind: "count"; alias: string }
  | { kind: "embed"; relation: string; hint?: string; inner: boolean; alias: string; items: SelectItem[] };

export function parseSelect(input: string | undefined): SelectItem[] {
  const text = (input ?? "*").replace(/\s+/g, "");
  if (!text || text === "*") return [{ kind: "star" }];
  let i = 0;
  const parseList = (): SelectItem[] => {
    const items: SelectItem[] = [];
    while (i < text.length && text[i] !== ")") {
      items.push(parseItem());
      if (text[i] === ",") i++;
      else break;
    }
    return items;
  };
  const readName = () => {
    const m = text.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (!m) throw new RestError(`Couldn't read the select list near "${text.slice(i, i + 20)}".`, 400, 'Use a list like "id, title, author:profiles(name)".');
    i += m[0].length;
    return m[0];
  };
  const parseItem = (): SelectItem => {
    if (text[i] === "*") {
      i++;
      return { kind: "star" };
    }
    let alias: string | undefined;
    let name = readName();
    if (text[i] === ":" && text[i + 1] !== ":") {
      i++;
      alias = name;
      name = readName();
    }
    if (text[i] === "!" || text[i] === "(") {
      let hint: string | undefined;
      let inner = false;
      while (text[i] === "!") {
        i++;
        const mod = readName();
        if (mod === "inner") inner = true;
        else if (mod !== "left") hint = mod;
      }
      if (text[i] !== "(") throw new RestError(`"${name}" needs a column list in brackets, like ${name}(*).`);
      i++;
      const items = parseList();
      if (text[i] !== ")") throw new RestError(`Missing ")" after ${name}(…).`);
      i++;
      if (items.length === 1 && items[0].kind === "column" && items[0].column === "count" && !items[0].path.length) {
        return { kind: "embed", relation: name, hint, inner, alias: alias ?? name, items: [{ kind: "count", alias: "count" }] };
      }
      return { kind: "embed", relation: name, hint, inner, alias: alias ?? name, items };
    }
    const path: string[] = [];
    const arrow: Array<"->" | "->>"> = [];
    while (text.startsWith("->", i)) {
      const op = text.startsWith("->>", i) ? "->>" : "->";
      i += op.length;
      arrow.push(op);
      path.push(readName());
    }
    let cast: string | undefined;
    if (text.startsWith("::", i)) {
      i += 2;
      cast = readName();
      if (!/^(text|int|integer|bigint|numeric|float|real|boolean|bool|date|timestamptz|timestamp|json|jsonb|uuid)$/.test(cast)) {
        throw new RestError(`Casting to "${cast}" isn't supported in a select list.`);
      }
    }
    return { kind: "column", column: name, path, arrow, alias: alias ?? (path.length ? path[path.length - 1] : name), cast };
  };
  const items = parseList();
  if (i < text.length) throw new RestError(`Couldn't read the select list near "${text.slice(i, i + 20)}".`);
  return items;
}

// ---------------------------------------------------------------- or() parsing

type LogicNode = { kind: "and" | "or"; negate: boolean; children: LogicNode[] } | { kind: "filter"; filter: Filter };

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === ",") {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

export function parseLogic(expression: string, kind: "and" | "or" = "or", negate = false): LogicNode {
  const children = splitTopLevel(expression.trim()).map((part): LogicNode => {
    const p = part.trim();
    const group = p.match(/^(not\.)?(and|or)\(([\s\S]*)\)$/);
    if (group) return parseLogic(group[3], group[2] as "and" | "or", !!group[1]);
    const m = p.match(/^([A-Za-z_][\w]*(?:->>?[\w]+)*)\.(not\.)?([a-zA-Z]+)\.([\s\S]*)$/);
    if (!m) throw new RestError(`Couldn't read the filter "${p}".`, 400, 'Write each condition as column.operator.value, like "status.eq.open".');
    const op = OPS[m[3]];
    if (!op) throw new RestError(`"${m[3]}" isn't a filter operator.`, 400, "Use eq, neq, gt, gte, lt, lte, like, ilike, in, is, cs, cd, ov or fts.");
    let value: unknown = m[4];
    if (op === "in") {
      const list = String(value).replace(/^\(|\)$/g, "");
      value = splitTopLevel(list).map((v) => v.trim().replace(/^"([\s\S]*)"$/, "$1"));
    } else if (op === "is") {
      value = m[4] === "null" ? null : m[4] === "true" ? true : m[4] === "false" ? false : m[4];
    } else if (typeof value === "string") {
      value = value.replace(/^"([\s\S]*)"$/, "$1");
      if (op === "like" || op === "ilike") value = String(value).replace(/\*/g, "%");
    }
    return { kind: "filter", filter: { column: m[1], op, value, negate: !!m[2] } };
  });
  return { kind, negate, children };
}

// ---------------------------------------------------------------- compiler

class Params {
  values: unknown[] = [];
  add(value: unknown, cast?: string): string {
    this.values.push(value);
    return cast ? `$${this.values.length}::${cast}` : `$${this.values.length}`;
  }
}

function tableOf(schema: SchemaInfo, name: string): TableInfo {
  if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new RestError("That isn't a valid table name.");
  const t = schema.tables.get(name);
  if (!t) {
    const near = [...schema.tables.keys()].find((k) => k.toLowerCase() === name.toLowerCase());
    throw new RestError(`The table "${name}" doesn't exist.`, 404, near ? `Did you mean "${near}"?` : "Create it in a migration (db/migrations/), then rebuild.");
  }
  return t;
}

function columnOf(table: TableInfo, name: string): ColumnInfo {
  const c = table.columns.get(name);
  if (!c) {
    throw new RestError(`The column "${name}" doesn't exist on "${table.name}".`, 400, `Columns on ${table.name}: ${[...table.columns.keys()].join(", ")}.`);
  }
  return c;
}

/** Column reference with optional JSON path ("meta->>plan"). Returns SQL and the type values compare as. */
function columnExpr(alias: string, table: TableInfo, ref: string): { sql: string; type: string; isArray: boolean } {
  const m = ref.match(/^([A-Za-z_][A-Za-z0-9_]*)((?:->>?[A-Za-z0-9_]+)*)$/);
  if (!m) throw new RestError(`"${ref}" isn't a valid column name.`);
  const col = columnOf(table, m[1]);
  if (!m[2]) return { sql: `${alias}.${q(col.name)}`, type: col.type, isArray: col.isArray };
  let sql = `${alias}.${q(col.name)}`;
  let lastText = false;
  for (const seg of m[2].matchAll(/(->>?)([A-Za-z0-9_]+)/g)) {
    sql += `${seg[1]}${/^\d+$/.test(seg[2]) ? seg[2] : `'${seg[2]}'`}`;
    lastText = seg[1] === "->>";
  }
  return { sql, type: lastText ? "text" : "jsonb", isArray: false };
}

function paramFor(params: Params, value: unknown, type: string): string {
  if (/^jsonb?$/.test(type)) return params.add(JSON.stringify(value), type);
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    throw new RestError(`A ${type} value can't be an object.`);
  }
  return params.add(value, type);
}

function filterSql(f: Filter, alias: string, table: TableInfo, params: Params): string {
  const op = OPS[f.op as string];
  if (!op) throw new RestError(`"${f.op}" isn't a filter operator.`);
  const col = columnExpr(alias, table, f.column);
  let sql: string;
  switch (op) {
    case "eq": sql = `${col.sql} = ${paramFor(params, f.value, col.type)}`; break;
    case "neq": sql = `${col.sql} <> ${paramFor(params, f.value, col.type)}`; break;
    case "gt": sql = `${col.sql} > ${paramFor(params, f.value, col.type)}`; break;
    case "gte": sql = `${col.sql} >= ${paramFor(params, f.value, col.type)}`; break;
    case "lt": sql = `${col.sql} < ${paramFor(params, f.value, col.type)}`; break;
    case "lte": sql = `${col.sql} <= ${paramFor(params, f.value, col.type)}`; break;
    case "like": sql = `${col.sql}::text LIKE ${params.add(String(f.value), "text")}`; break;
    case "ilike": sql = `${col.sql}::text ILIKE ${params.add(String(f.value), "text")}`; break;
    case "in": {
      if (!Array.isArray(f.value)) throw new RestError(`.in("${f.column}", …) needs a list of values.`);
      sql = `${col.sql} = ANY(${params.add(f.value, `${col.type}[]`)})`;
      break;
    }
    case "is": {
      const v = f.value === null || f.value === "null" ? "NULL" : f.value === true || f.value === "true" ? "TRUE" : f.value === false || f.value === "false" ? "FALSE" : null;
      if (!v) throw new RestError(`.is("${f.column}", …) only accepts null, true or false.`);
      sql = `${col.sql} IS ${v}`;
      break;
    }
    case "contains": sql = `${col.sql} @> ${paramFor(params, f.value, col.type)}`; break;
    case "containedBy": sql = `${col.sql} <@ ${paramFor(params, f.value, col.type)}`; break;
    case "overlaps": sql = `${col.sql} && ${paramFor(params, f.value, col.type)}`; break;
    case "textSearch": {
      const doc = col.type === "tsvector" ? col.sql : `to_tsvector('simple', ${col.sql}::text)`;
      sql = `${doc} @@ websearch_to_tsquery('simple', ${params.add(String(f.value), "text")})`;
      break;
    }
  }
  return f.negate ? `NOT (${sql})` : sql;
}

function logicSql(node: LogicNode, alias: string, table: TableInfo, params: Params): string {
  if (node.kind === "filter") return filterSql(node.filter, alias, table, params);
  const inner = node.children.map((c) => logicSql(c, alias, table, params)).join(node.kind === "and" ? " AND " : " OR ");
  return `${node.negate ? "NOT " : ""}(${inner || "TRUE"})`;
}

type Relation = { target: TableInfo; join: (outer: string, inner: string) => string; many: boolean };

function resolveRelation(schema: SchemaInfo, base: TableInfo, name: string, hint?: string): Relation {
  // By table name, or by a foreign-key column / constraint name ("author_id", "posts_author_id_fkey").
  const candidates: Array<{ fk: ForeignKey; direction: "out" | "in" }> = [];
  for (const fk of schema.foreignKeys) {
    if (fk.table === base.name && (fk.refTable === name || fk.columns.length === 1 && fk.columns[0] === name || fk.name === name)) candidates.push({ fk, direction: "out" });
    if (fk.refTable === base.name && (fk.table === name || fk.name === name)) candidates.push({ fk, direction: "in" });
  }
  let picked = candidates;
  if (hint) picked = candidates.filter(({ fk }) => fk.name === hint || fk.columns.includes(hint) || fk.table === hint || fk.refTable === hint);
  if (!picked.length) {
    throw new RestError(`"${base.name}" has no relationship to "${name}".`, 400, `Add a foreign key (e.g. ${name}_id references ${name}(id)) in a migration, or check the spelling.`);
  }
  if (picked.length > 1) {
    const options = picked.map(({ fk }) => `${name}!${fk.columns.join("_")}`).join(" or ");
    throw new RestError(`"${base.name}" is related to "${name}" in more than one way.`, 400, `Say which one, e.g. ${options}.`);
  }
  const { fk, direction } = picked[0];
  if (direction === "out") {
    const target = tableOf(schema, fk.refTable);
    return { target, many: false, join: (outer, inner) => fk.columns.map((c, i) => `${inner}.${q(fk.refColumns[i])} = ${outer}.${q(c)}`).join(" AND ") };
  }
  const target = tableOf(schema, fk.table);
  return { target, many: true, join: (outer, inner) => fk.columns.map((c, i) => `${inner}.${q(c)} = ${outer}.${q(fk.refColumns[i])}`).join(" AND ") };
}

type Ctx = { schema: SchemaInfo; params: Params; depth: number; embedFilters: Map<string, Filter[]>; embedOrder: Map<string, Order[]> };

function projection(items: SelectItem[], alias: string, table: TableInfo, ctx: Ctx, path: string): { columns: string[]; innerJoins: string[] } {
  const columns: string[] = [];
  const innerJoins: string[] = [];
  for (const item of items) {
    if (item.kind === "star") columns.push(`${alias}.*`);
    else if (item.kind === "column") {
      const ref = item.path.length ? `${item.column}${item.path.map((p, i) => `${item.arrow[i]}${p}`).join("")}` : item.column;
      const expr = columnExpr(alias, table, ref);
      columns.push(`${expr.sql}${item.cast ? `::${item.cast}` : ""} AS ${q(item.alias)}`);
    } else if (item.kind === "count") {
      columns.push(`count(*) AS ${q(item.alias)}`);
    } else {
      if (ctx.depth >= 3) throw new RestError("Related rows can be nested at most three levels deep.");
      const rel = resolveRelation(ctx.schema, table, item.relation, item.hint);
      const inner = `_e${++ctx.depth}`;
      const embedPath = path ? `${path}.${item.alias}` : item.alias;
      const where = [rel.join(alias, inner), ...(ctx.embedFilters.get(embedPath) ?? []).map((f) => filterSql(f, inner, rel.target, ctx.params))];
      const isCount = item.items.length === 1 && item.items[0].kind === "count";
      const sub = isCount ? { columns: ["count(*) AS \"count\""], innerJoins: [] } : projection(item.items, inner, rel.target, ctx, embedPath);
      const where2 = [...where, ...sub.innerJoins];
      const orderBy = (ctx.embedOrder.get(embedPath) ?? []).map((o) => orderSql(o, inner, rel.target)).join(", ");
      const body = `SELECT ${sub.columns.join(", ")} FROM public.${q(rel.target.name)} AS ${inner} WHERE ${where2.join(" AND ")}${orderBy && !isCount ? ` ORDER BY ${orderBy}` : ""}`;
      const subquery = rel.many && !isCount
        ? `coalesce((SELECT jsonb_agg(_r) FROM (${body}) _r), '[]'::jsonb)`
        : isCount
          ? `(SELECT jsonb_build_array(to_jsonb(_r)) FROM (${body}) _r)`
          : `(SELECT to_jsonb(_r) FROM (${body} LIMIT 1) _r)`;
      columns.push(`${subquery} AS ${q(item.alias)}`);
      if (item.inner) innerJoins.push(`EXISTS (SELECT 1 FROM public.${q(rel.target.name)} AS ${inner}x WHERE ${rel.join(alias, `${inner}x`)}${(ctx.embedFilters.get(embedPath) ?? []).map((f) => ` AND ${filterSql(f, `${inner}x`, rel.target, ctx.params)}`).join("")})`);
    }
  }
  return { columns, innerJoins };
}

function orderSql(o: Order, alias: string, table: TableInfo): string {
  const col = columnExpr(alias, table, o.column);
  return `${col.sql} ${o.ascending === false ? "DESC" : "ASC"}${o.nullsFirst === true ? " NULLS FIRST" : o.nullsFirst === false ? " NULLS LAST" : ""}`;
}

function validateLimit(n: unknown, name: string): number | undefined {
  if (n === undefined || n === null) return undefined;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) throw new RestError(`${name} must be a whole number.`);
  return n;
}

function rowsOf(values: unknown, action: string): Record<string, unknown>[] {
  const rows = Array.isArray(values) ? values : [values];
  if (!rows.length) throw new RestError(`Nothing to ${action}.`);
  if (rows.length > MAX_ROWS) throw new RestError(`At most ${MAX_ROWS} rows can be written at once.`);
  for (const r of rows) {
    if (!r || typeof r !== "object" || Array.isArray(r)) throw new RestError(`Each row to ${action} must be an object of { column: value }.`);
  }
  return rows as Record<string, unknown>[];
}

export function compileQuery(schema: SchemaInfo, state: QueryState): Compiled {
  const table = tableOf(schema, state.table);
  const params = new Params();
  const ctx: Ctx = { schema, params, depth: 0, embedFilters: new Map(), embedOrder: new Map() };
  const alias = "_t";

  // Filters/orders on embedded rows ("comments.approved") apply inside that embed.
  const baseFilters: Filter[] = [];
  for (const f of state.filters ?? []) {
    const dot = f.column.lastIndexOf(".");
    if (dot > 0 && !f.column.includes("->")) {
      const key = f.column.slice(0, dot);
      ctx.embedFilters.set(key, [...(ctx.embedFilters.get(key) ?? []), { ...f, column: f.column.slice(dot + 1) }]);
    } else baseFilters.push(f);
  }
  const baseOrder: Order[] = [];
  for (const o of state.order ?? []) {
    if (o.foreignTable) ctx.embedOrder.set(o.foreignTable, [...(ctx.embedOrder.get(o.foreignTable) ?? []), o]);
    else baseOrder.push(o);
  }

  const where = (a: string) => [
    ...baseFilters.map((f) => filterSql(f, a, table, params)),
    ...(state.or ?? []).map((expr) => logicSql(parseLogic(expr), a, table, params)),
  ];
  const limit = validateLimit(state.limit, "limit");
  const offset = validateLimit(state.offset, "offset");
  const single = state.single;

  if (state.action === "select") {
    const items = parseSelect(state.columns);
    const proj = projection(items, alias, table, ctx, "");
    const conds = [...where(alias), ...proj.innerJoins];
    const whereSql = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
    const orderBy = baseOrder.length ? ` ORDER BY ${baseOrder.map((o) => orderSql(o, alias, table)).join(", ")}` : "";
    const effectiveLimit = single ? 2 : Math.min(limit ?? MAX_ROWS, MAX_ROWS);
    const base = `SELECT ${proj.columns.join(", ")} FROM public.${q(table.name)} AS ${alias}${whereSql}${orderBy} LIMIT ${effectiveLimit}${offset ? ` OFFSET ${offset}` : ""}`;
    const countSql = state.count === "exact" ? `(SELECT count(*) FROM public.${q(table.name)} AS ${alias}${whereSql})` : "NULL::bigint";
    if (state.head) return { sql: `SELECT NULL::jsonb AS data, ${countSql} AS count`, params: params.values, mode: "json" };
    return { sql: `SELECT coalesce(jsonb_agg(_b), '[]'::jsonb) AS data, ${countSql} AS count FROM (${base}) _b`, params: params.values, mode: "json", single };
  }

  let mutation: string;
  if (state.action === "insert" || state.action === "upsert") {
    const rows = rowsOf(state.values, state.action === "insert" ? "insert" : "save");
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    if (!cols.length) throw new RestError("Each row needs at least one column.");
    cols.forEach((c) => columnOf(table, c));
    const colList = cols.map(q).join(", ");
    mutation = `INSERT INTO public.${q(table.name)} AS ${alias} (${colList}) SELECT ${colList} FROM jsonb_populate_recordset(NULL::public.${q(table.name)}, ${params.add(JSON.stringify(rows), "jsonb")})`;
    if (state.action === "upsert") {
      const target = (state.onConflict ? state.onConflict.split(",").map((s) => s.trim()).filter(Boolean) : table.primaryKey);
      if (!target.length) throw new RestError(`"${table.name}" has no primary key to match rows on.`, 400, 'Pass onConflict with a unique column, like upsert(row, { onConflict: "email" }).');
      target.forEach((c) => columnOf(table, c));
      const updates = cols.filter((c) => !target.includes(c));
      mutation += state.ignoreDuplicates || !updates.length
        ? ` ON CONFLICT (${target.map(q).join(", ")}) DO NOTHING`
        : ` ON CONFLICT (${target.map(q).join(", ")}) DO UPDATE SET ${updates.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(", ")}`;
    }
  } else if (state.action === "update") {
    const [row] = rowsOf(state.values, "update");
    if (Array.isArray(state.values)) throw new RestError("update() takes one object of changes, applied to every matching row.");
    const cols = Object.keys(row);
    if (!cols.length) throw new RestError("Nothing to update — pass the columns to change.");
    cols.forEach((c) => columnOf(table, c));
    const conds = where(alias);
    if (!conds.length) throw new RestError("Refusing to update every row.", 400, 'Add a filter, like .update({ … }).eq("id", id).');
    // jsonb_populate_record casts each JSON value to its column's type.
    const record = `jsonb_populate_record(NULL::public.${q(table.name)}, ${params.add(JSON.stringify(row), "jsonb")})`;
    mutation = cols.length === 1
      ? `UPDATE public.${q(table.name)} AS ${alias} SET ${q(cols[0])} = (SELECT ${q(cols[0])} FROM ${record}) WHERE ${conds.join(" AND ")}`
      : `UPDATE public.${q(table.name)} AS ${alias} SET (${cols.map(q).join(", ")}) = (SELECT ${cols.map(q).join(", ")} FROM ${record}) WHERE ${conds.join(" AND ")}`;
  } else if (state.action === "delete") {
    const conds = where(alias);
    if (!conds.length) throw new RestError("Refusing to delete every row.", 400, 'Add a filter, like .delete().eq("id", id).');
    mutation = `DELETE FROM public.${q(table.name)} AS ${alias} WHERE ${conds.join(" AND ")}`;
  } else {
    throw new RestError(`Unknown action "${(state as any).action}".`);
  }

  if (!state.returning) return { sql: mutation, params: params.values, mode: "rowCount" };

  // .select() after a write: return the written rows, with related rows if asked for.
  const items = parseSelect(state.columns);
  const proj = projection(items, alias, table, ctx, "");
  const orderBy = baseOrder.length ? ` ORDER BY ${baseOrder.map((o) => orderSql(o, alias, table)).join(", ")}` : "";
  return {
    sql: `WITH _w AS (${mutation} RETURNING ${alias}.*) SELECT coalesce(jsonb_agg(_b), '[]'::jsonb) AS data, NULL::bigint AS count FROM (SELECT ${proj.columns.join(", ")} FROM _w AS ${alias}${orderBy}) _b`,
    params: params.values,
    mode: "json",
    single,
  };
}

/** plexo.rpc("fn", { a: 1 }) → SELECT … FROM public.fn(a => $1::int). */
export function compileRpc(schema: SchemaInfo, fn: string, args: Record<string, unknown>): Compiled {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(fn)) throw new RestError("That isn't a valid function name.");
  const overloads = schema.functions.get(fn);
  if (!overloads?.length) throw new RestError(`The function "${fn}" doesn't exist.`, 404, "Create it in a migration with `create function public.…`.");
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new RestError("rpc arguments must be an object of { name: value }.");
  const given = Object.keys(args);
  const match = overloads.find((o) => given.every((g) => o.args.some((a) => a.name === g)) && o.args.every((a) => a.hasDefault || given.includes(a.name)));
  if (!match) {
    const sig = overloads.map((o) => `${fn}(${o.args.map((a) => `${a.name}${a.hasDefault ? "?" : ""}`).join(", ")})`).join(" or ");
    throw new RestError(`No version of ${fn} takes those arguments.`, 400, `It takes: ${sig}.`);
  }
  const params = new Params();
  const argSql = given.map((g) => {
    const a = match.args.find((x) => x.name === g)!;
    return `${q(g)} => ${paramFor(params, args[g], a.type)}`;
  }).join(", ");
  const call = `public.${q(fn)}(${argSql})`;
  const sql = match.returnsSet || /^record$|^SETOF/i.test(match.returnType)
    ? `SELECT coalesce(jsonb_agg(_r), '[]'::jsonb) AS data, NULL::bigint AS count FROM ${call} AS _r`
    : match.returnType === "void"
      ? `SELECT NULL::jsonb AS data, NULL::bigint AS count FROM (SELECT ${call}) _v`
      : `SELECT to_jsonb(${call}) AS data, NULL::bigint AS count`;
  return { sql, params: params.values, mode: "json" };
}

/** Turns the statement's result into what the client gets back. */
export function shapeResult(compiled: Compiled, row: { data?: unknown; count?: unknown } | undefined, rowCount: number | null): { data: unknown; count: number | null } {
  if (compiled.mode === "rowCount") return { data: null, count: rowCount };
  let data = row?.data ?? null;
  const count = row?.count === null || row?.count === undefined ? null : Number(row.count);
  if (compiled.single && Array.isArray(data)) {
    if (data.length > 1) throw new RestError("Expected one row, but more than one matched.", 406, "Add a filter that matches a single row (like .eq(\"id\", id)), or drop .single().");
    if (data.length === 0) {
      if (compiled.single === "single") throw new RestError("Expected one row, but none matched.", 406, "Use .maybeSingle() when the row might not exist.");
      data = null;
    } else data = data[0];
  }
  return { data, count };
}
