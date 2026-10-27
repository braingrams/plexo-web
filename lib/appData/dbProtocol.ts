// The contract between the app server (lib/appData/db.ts) and AppDbFn (lambda/app-db), the
// Lambda inside the database VPC that runs an app's SQL. Dependency-free: both sides import
// it.

/** Which of the app database's login roles to connect as:
 * - "api":    the REST gateway. Can only become plexo_anon / plexo_authenticated, so every
 *             row it touches is filtered by the app's row-level-security policies.
 * - "owner":  owns the app's tables — migrations, the SQL editor, server functions.
 * - "system": owns the plexo schema (visitor accounts, sessions) — Plexo's own auth code. */
export type DbLogin = "api" | "owner" | "system";

export type DbStatement = {
  sql: string;
  params?: unknown[];
  /** Multi-statement SQL text (migrations, the SQL editor). Runs without parameters, via
   * PostgreSQL's simple query protocol. */
  script?: boolean;
};

export type DbRequest = {
  database: string;
  login: DbLogin;
  /** For login "api": which client role to act as, and the visitor's claims. */
  as?: "anon" | "authenticated";
  claims?: { uid: string | null; role: string | null; email: string | null };
  statements: DbStatement[];
  /** Run every statement in one transaction (default true). */
  transaction?: boolean;
  /** Per-statement timeout, ms. */
  statementTimeoutMs?: number;
  /** Return at most this many rows per statement (protects the gateway's memory). */
  maxRows?: number;
};

export type DbField = { name: string; dataTypeID: number };

export type DbResult = { rows: Record<string, unknown>[]; rowCount: number | null; fields: DbField[]; truncated?: boolean; command?: string };

export type DbError = {
  message: string;
  /** SQLSTATE, e.g. 42P01 (undefined table), 42501 (insufficient privilege). */
  code?: string;
  detail?: string;
  hint?: string;
  position?: number;
  /** Which statement (0-based) failed. */
  statementIndex?: number;
  /** "resuming": the database is waking from auto-pause and didn't come up in time. */
  kind?: "query" | "connection" | "resuming" | "timeout";
};

export type DbResponse = { ok: true; results: DbResult[]; durationMs: number } | { ok: false; error: DbError };
