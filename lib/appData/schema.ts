import type { DbStatement, DbResult } from "./dbProtocol";

// What the REST compiler needs to know about an app's public schema: tables and their
// columns (to validate names and cast values to the right type), primary keys (upsert
// targets), foreign keys (embedding related rows), and functions (rpc). Read with one
// round trip, cached per database + schemaVersion (bumped by every migration).

export type ColumnInfo = { name: string; type: string; notNull: boolean; hasDefault: boolean; isArray: boolean };
export type TableInfo = { name: string; kind: "table" | "view"; columns: Map<string, ColumnInfo>; primaryKey: string[]; rls: boolean; policyCount: number };
export type ForeignKey = { name: string; table: string; columns: string[]; refTable: string; refColumns: string[] };
export type FunctionInfo = { name: string; args: Array<{ name: string; type: string; hasDefault: boolean }>; returnsSet: boolean; returnType: string };
export type SchemaInfo = { tables: Map<string, TableInfo>; foreignKeys: ForeignKey[]; functions: Map<string, FunctionInfo[]> };

export const INTROSPECTION_STATEMENTS: DbStatement[] = [
  {
    sql: `SELECT c.relname::text AS table, c.relkind::text AS kind, c.relrowsecurity AS rls,
            (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies,
            a.attname::text AS column, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
            a.atthasdef OR a.attidentity <> '' OR a.attgenerated <> '' AS has_default, a.attndims > 0 OR t.typcategory = 'A' AS is_array
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          JOIN pg_type t ON t.oid = a.atttypid
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          ORDER BY c.relname, a.attnum`,
  },
  {
    sql: `SELECT con.conname::text AS name, con.contype::text AS type, cl.relname::text AS table,
            array_agg(att.attname::text ORDER BY k.ord) AS columns,
            fcl.relname::text AS ref_table,
            array_agg(fatt.attname::text ORDER BY k.ord) FILTER (WHERE fatt.attname IS NOT NULL) AS ref_columns
          FROM pg_constraint con
          JOIN pg_class cl ON cl.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = cl.relnamespace
          LEFT JOIN pg_class fcl ON fcl.oid = con.confrelid
          LEFT JOIN pg_namespace fn ON fn.oid = fcl.relnamespace
          CROSS JOIN LATERAL unnest(con.conkey, CASE WHEN con.contype = 'f' THEN con.confkey ELSE con.conkey END) WITH ORDINALITY AS k(attnum, fattnum, ord)
          JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
          LEFT JOIN pg_attribute fatt ON con.contype = 'f' AND fatt.attrelid = con.confrelid AND fatt.attnum = k.fattnum
          WHERE n.nspname = 'public' AND (con.contype = 'p' OR (con.contype = 'f' AND fn.nspname = 'public'))
          GROUP BY con.conname, con.contype, cl.relname, fcl.relname`,
  },
  {
    sql: `SELECT p.proname::text AS name, p.proretset AS returns_set, format_type(p.prorettype, NULL) AS return_type,
            coalesce(p.proargnames, ARRAY[]::text[]) AS arg_names,
            coalesce(p.proargmodes::text[], ARRAY[]::text[]) AS arg_modes,
            coalesce((SELECT array_agg(format_type(t, NULL) ORDER BY o) FROM unnest(p.proallargtypes) WITH ORDINALITY AS x(t, o)),
                     (SELECT array_agg(format_type(t, NULL) ORDER BY o) FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS x(t, o)),
                     ARRAY[]::text[]) AS arg_types,
            p.pronargdefaults AS n_defaults, p.pronargs AS n_args
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.prokind = 'f'`,
  },
];

export function parseIntrospection(results: DbResult[]): SchemaInfo {
  const tables = new Map<string, TableInfo>();
  for (const r of results[0].rows as any[]) {
    let t = tables.get(r.table);
    if (!t) {
      t = { name: r.table, kind: r.kind === "v" || r.kind === "m" ? "view" : "table", columns: new Map(), primaryKey: [], rls: !!r.rls, policyCount: Number(r.policies) || 0 };
      tables.set(r.table, t);
    }
    t.columns.set(r.column, { name: r.column, type: r.type, notNull: !!r.not_null, hasDefault: !!r.has_default, isArray: !!r.is_array });
  }
  const foreignKeys: ForeignKey[] = [];
  for (const r of results[1].rows as any[]) {
    if (r.type === "p") {
      const t = tables.get(r.table);
      if (t) t.primaryKey = r.columns;
    } else if (r.ref_table) {
      foreignKeys.push({ name: r.name, table: r.table, columns: r.columns, refTable: r.ref_table, refColumns: r.ref_columns ?? [] });
    }
  }
  const functions = new Map<string, FunctionInfo[]>();
  for (const r of results[2].rows as any[]) {
    const modes: string[] = r.arg_modes ?? [];
    const names: string[] = r.arg_names ?? [];
    const types: string[] = r.arg_types ?? [];
    const inputs = types
      .map((type, i) => ({ name: names[i] ?? `$${i + 1}`, type, mode: modes[i] ?? "i" }))
      .filter((a) => a.mode === "i" || a.mode === "b" || a.mode === "v");
    const firstDefault = inputs.length - Number(r.n_defaults || 0);
    const info: FunctionInfo = {
      name: r.name,
      args: inputs.map((a, i) => ({ name: a.name, type: a.type, hasDefault: i >= firstDefault })),
      returnsSet: !!r.returns_set,
      returnType: r.return_type,
    };
    functions.set(r.name, [...(functions.get(r.name) ?? []), info]);
  }
  return { tables, foreignKeys, functions };
}

const cache = new Map<string, { schema: SchemaInfo; at: number }>();
const TTL_MS = 5 * 60 * 1000;

export async function getSchema(key: string, load: () => Promise<DbResult[]>): Promise<SchemaInfo> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.schema;
  const schema = parseIntrospection(await load());
  cache.set(key, { schema, at: Date.now() });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return schema;
}
