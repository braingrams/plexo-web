import { createHash } from "node:crypto";
import { AppDatabase, type AppEnv } from "@/lib/db/appEntities";
import { runDb, AppDbError } from "./db";
import { ensureAppDatabase } from "./provision";
import type { DbResult, DbStatement } from "./dbProtocol";

// Applies an app's db/migrations/*.sql, and runs owner SQL from the editor, with the same
// two guarantees:
// - All or nothing: each migration (or editor run) is one transaction.
// - Secure by default: every table it creates in `public` gets row-level security switched
//   on — nobody can reach it from the app until a policy says who can — unless that same SQL
//   explicitly says `disable row level security` for it.

export type MigrationFile = { name: string; sql: string };

export type MigrationOutcome = {
  applied: string[];
  skipped: string[];
  failed?: { name: string; message: string; line?: number; hint?: string };
  /** Applied earlier, but the file has since been edited — edits to applied migrations
   * never run; a new migration is needed. */
  edited: string[];
};

const MIGRATION_PATH = /^db\/migrations\/([^/]+\.sql)$/;

export function migrationFilesFrom(files: Array<{ path: string; content?: string }>): MigrationFile[] {
  return files
    .flatMap((f) => {
      const m = f.path.match(MIGRATION_PATH);
      return m && typeof f.content === "string" ? [{ name: m[1], sql: f.content }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
}

export const checksum = (sql: string) => createHash("sha256").update(sql.replace(/\r\n/g, "\n").trim()).digest("hex").slice(0, 32);

/** Table names this SQL explicitly opts out of RLS for ("alter table x disable row level security"). */
export function rlsOptOuts(sql: string): string[] {
  const out = new Set<string>();
  const re = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)\s+disable\s+row\s+level\s+security/gi;
  for (const m of sql.matchAll(re)) out.add(m[1].replace(/"/g, "").replace(/^public\./i, "").toLowerCase());
  return [...out];
}

const sqlLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Statements wrapping a piece of owner SQL: snapshot tables → the SQL → enable RLS on new
 * tables → (optional) record the migration. Runs in one transaction. */
export function wrapOwnerSql(rawSql: string, record?: { name: string; checksum: string }): DbStatement[] {
  // Hand-written migrations often carry their own BEGIN/COMMIT lines; inside our
  // transaction they would commit half-way and break all-or-nothing. Every run is already
  // one transaction, so they're simply dropped.
  const sql = rawSql.replace(/^\s*(begin(\s+transaction)?|start\s+transaction|commit(\s+transaction)?|end(\s+transaction)?)\s*;\s*$/gim, "");
  const optOuts = rlsOptOuts(sql);
  const excluded = optOuts.length ? `AND lower(c.relname) <> ALL (ARRAY[${optOuts.map(sqlLiteral).join(",")}])` : "";
  const statements: DbStatement[] = [
    {
      sql: `CREATE TEMP TABLE IF NOT EXISTS _plexo_tables_before ON COMMIT DROP AS
              SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`,
    },
    { sql, script: true },
    {
      sql: `DO $plexo$ DECLARE r record; BEGIN
              FOR r IN SELECT c.oid::regclass AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
                  AND c.oid NOT IN (SELECT oid FROM _plexo_tables_before) ${excluded}
              LOOP EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', r.t); END LOOP;
            END $plexo$`,
    },
  ];
  if (record) {
    statements.push({ sql: "INSERT INTO plexo.migrations (name, checksum) VALUES ($1, $2)", params: [record.name, record.checksum] });
  }
  return statements;
}

/** Line number (1-based) of a Postgres error position inside the SQL text. */
export function lineAt(sql: string, position?: number): number | undefined {
  if (!position || position < 1) return undefined;
  return sql.slice(0, position - 1).split("\n").length;
}

export async function applyMigrations(input: { templateId: string; organizationId: string; env: AppEnv; files: MigrationFile[] }): Promise<MigrationOutcome> {
  const outcome: MigrationOutcome = { applied: [], skipped: [], edited: [] };
  if (!input.files.length) return outcome;
  const { database } = await ensureAppDatabase(input.templateId, input.organizationId, input.env);

  const [done] = await runDb({ database, login: "owner", statements: [{ sql: "SELECT name, checksum FROM plexo.migrations" }] });
  const applied = new Map(done.rows.map((r) => [String(r.name), String(r.checksum)]));

  for (const file of input.files) {
    const sum = checksum(file.sql);
    if (applied.has(file.name)) {
      outcome.skipped.push(file.name);
      if (applied.get(file.name) !== sum) outcome.edited.push(file.name);
      continue;
    }
    try {
      await runDb({ database, login: "owner", statements: wrapOwnerSql(file.sql, { name: file.name, checksum: sum }), statementTimeoutMs: 120_000 });
      outcome.applied.push(file.name);
    } catch (err) {
      if (!(err instanceof AppDbError)) throw err;
      outcome.failed = {
        name: file.name,
        message: err.error.message,
        line: err.error.statementIndex === 1 ? lineAt(file.sql, err.error.position) : undefined,
        hint: err.error.hint,
      };
      break; // later migrations may depend on this one
    }
  }
  if (outcome.applied.length) {
    const { data: row } = await AppDatabase.get({ templateId: input.templateId, env: input.env }).go();
    await AppDatabase.patch({ templateId: input.templateId, env: input.env })
      .set({ schemaVersion: (row?.schemaVersion ?? 1) + 1, lastMigrationAt: new Date().toISOString() })
      .go();
  }
  return outcome;
}

/** The dashboard's SQL editor (and SOL's app_sql): runs as the app's owner, secure-by-default
 * the same way migrations are. Returns the last statement's rows. */
export async function runOwnerSql(input: { templateId: string; organizationId: string; env: AppEnv; sql: string; maxRows?: number }): Promise<DbResult> {
  const { database } = await ensureAppDatabase(input.templateId, input.organizationId, input.env);
  const results = await runDb({ database, login: "owner", statements: wrapOwnerSql(input.sql), statementTimeoutMs: 60_000, maxRows: input.maxRows ?? 1000 });
  if (/\b(create|alter|drop)\b/i.test(input.sql)) {
    const { data: row } = await AppDatabase.get({ templateId: input.templateId, env: input.env }).go();
    await AppDatabase.patch({ templateId: input.templateId, env: input.env }).set({ schemaVersion: (row?.schemaVersion ?? 1) + 1 }).go();
  }
  return results[1];
}
