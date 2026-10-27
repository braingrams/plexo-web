import { runDb } from "./db";
import { INTROSPECTION_STATEMENTS, parseIntrospection } from "./schema";
import { ensureAppDatabase } from "./provision";
import type { AppContext } from "@/lib/appRuntime/context";

// The database panel's view of an app's schema, plus a security check written for owners:
// what's exposed, what's locked shut, and what to do about it. The same check runs before
// publish and is reported to SOL after migrations.

export type SecurityFinding = {
  level: "danger" | "warning" | "info";
  table: string;
  message: string;
  fix: string;
};

export type TableOverview = {
  name: string;
  kind: "table" | "view";
  rowEstimate: number;
  rls: boolean;
  policies: Array<{ name: string; command: string; roles: string[]; using: string | null; check: string | null }>;
  columns: Array<{ name: string; type: string; nullable: boolean; hasDefault: boolean; primaryKey: boolean; references: string | null }>;
};

export async function databaseOverview(ctx: AppContext): Promise<{ tables: TableOverview[]; findings: SecurityFinding[]; migrations: Array<{ name: string; appliedAt: string }> }> {
  await ensureAppDatabase(ctx.templateId, ctx.organizationId, ctx.env);
  const results = await runDb({
    database: ctx.database,
    login: "owner",
    statements: [
      ...INTROSPECTION_STATEMENTS,
      {
        sql: `SELECT c.relname::text AS table, p.polname::text AS name,
                CASE p.polcmd WHEN 'r' THEN 'select' WHEN 'a' THEN 'insert' WHEN 'w' THEN 'update' WHEN 'd' THEN 'delete' ELSE 'all' END AS command,
                coalesce((SELECT array_agg(rolname::text) FROM pg_roles WHERE oid = ANY(p.polroles)), ARRAY['public']) AS roles,
                pg_get_expr(p.polqual, p.polrelid) AS using, pg_get_expr(p.polwithcheck, p.polrelid) AS check
              FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' ORDER BY c.relname, p.polname`,
      },
      {
        sql: `SELECT c.relname::text AS table, greatest(c.reltuples, 0)::bigint AS estimate,
                coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions) WHERE option_name = 'security_invoker'), 'false') AS security_invoker
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')`,
      },
      { sql: "SELECT name, applied_at FROM plexo.migrations ORDER BY name" },
      {
        sql: `SELECT c.relname::text AS table, has_table_privilege('plexo_anon', c.oid, 'SELECT') AS anon_select
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')`,
      },
    ],
  });
  const schema = parseIntrospection(results.slice(0, 3));
  const policies = results[3].rows as any[];
  const stats = new Map((results[4].rows as any[]).map((r) => [r.table, r]));
  const anonSelect = new Map((results[6].rows as any[]).map((r) => [r.table, !!r.anon_select]));
  const fkByColumn = new Map<string, string>();
  for (const fk of schema.foreignKeys) fk.columns.forEach((c, i) => fkByColumn.set(`${fk.table}.${c}`, `${fk.refTable}.${fk.refColumns[i]}`));

  const tables: TableOverview[] = [...schema.tables.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({
      name: t.name,
      kind: t.kind,
      rowEstimate: Number(stats.get(t.name)?.estimate ?? 0),
      rls: t.rls,
      policies: policies.filter((p) => p.table === t.name).map((p) => ({ name: p.name, command: p.command, roles: p.roles, using: p.using, check: p.check })),
      columns: [...t.columns.values()].map((c) => ({
        name: c.name,
        type: c.type,
        nullable: !c.notNull,
        hasDefault: c.hasDefault,
        primaryKey: t.primaryKey.includes(c.name),
        references: fkByColumn.get(`${t.name}.${c.name}`) ?? null,
      })),
    }));

  const findings: SecurityFinding[] = [];
  for (const t of tables) {
    if (t.kind === "view") {
      if (stats.get(t.name)?.security_invoker !== "true" && anonSelect.get(t.name)) {
        findings.push({
          level: "warning",
          table: t.name,
          message: `The view "${t.name}" shows rows without checking the row-level security of the tables it reads.`,
          fix: `Recreate it with: create view ${t.name} with (security_invoker = true) as …`,
        });
      }
      continue;
    }
    if (!t.rls) {
      findings.push({
        level: "danger",
        table: t.name,
        message: `Anyone can read and change every row in "${t.name}" — row-level security is off.`,
        fix: `Add a migration: alter table public.${t.name} enable row level security; then add policies for who may read and write it.`,
      });
    } else if (!t.policies.length) {
      findings.push({
        level: "info",
        table: t.name,
        message: `Nobody can reach "${t.name}" from the app yet (it has no policies) — fine for server-only data.`,
        fix: `To let signed-in people use it: create policy "…" on public.${t.name} for select to plexo_authenticated using (…);`,
      });
    } else if (t.policies.some((p) => p.roles.includes("plexo_anon") && p.command !== "select" && (p.using === "true" || p.check === "true"))) {
      findings.push({
        level: "warning",
        table: t.name,
        message: `Signed-out visitors can change rows in "${t.name}".`,
        fix: "Make sure that's intended (e.g. a public contact form). Otherwise limit the policy to plexo_authenticated.",
      });
    }
  }
  return {
    tables,
    findings,
    migrations: (results[5].rows as any[]).map((m) => ({ name: m.name, appliedAt: m.applied_at })),
  };
}
