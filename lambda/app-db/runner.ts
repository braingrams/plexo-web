// The transaction logic of AppDbFn, independent of how connections are made (IAM in the
// Lambda, passwords in tests/appDataPostgres.test.ts) — so the code that decides roles,
// claims and transactions is the same code the security tests exercise.
import pg from "pg";
import type { DbRequest, DbResponse, DbResult, DbError } from "../../lib/appData/dbProtocol";

// int8 → number when it fits (count(*), bigserial ids); numeric stays a string so exact
// money values are never rounded.
pg.types.setTypeParser(20, (v: string) => {
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : v;
});

export type Connection = { client: pg.Client; markBroken(): void };
export type Connector = (database: string, user: string) => Promise<Connection>;

const LOGIN_SUFFIX = { api: "api", owner: "owner", system: "system" } as const;
export const SAFE_DB = /^a_[a-z0-9]{32}_(dev|live)$/;

export function toError(err: any, statementIndex?: number): DbError {
  const message = String(err?.message ?? err);
  if (/timeout expired|Connection terminated due to connection timeout/i.test(message)) {
    return { message: "The database is waking up and took too long — please try again in a few seconds.", kind: "resuming" };
  }
  if (err?.code === "57014") return { message: "The query took too long and was stopped.", code: err.code, kind: "timeout", statementIndex };
  return {
    message,
    code: err?.code,
    detail: err?.detail,
    hint: err?.hint,
    position: err?.position ? Number(err.position) : undefined,
    statementIndex,
    kind: err?.code ? "query" : "connection",
  };
}

const isConnectionLoss = (err: any) =>
  !err?.code || ["57P01", "57P02", "57P03", "08000", "08003", "08006"].includes(err.code) || /terminat|ECONNRESET|EPIPE|not queryable|Connection terminated/i.test(String(err?.message));

export async function runRequest(req: DbRequest, connect: Connector, attempt = 0): Promise<DbResponse> {
  const started = Date.now();
  if (!SAFE_DB.test(req.database)) return { ok: false, error: { message: "Unknown database.", kind: "query" } };
  if (!(req.login in LOGIN_SUFFIX)) return { ok: false, error: { message: "Unknown login.", kind: "query" } };
  const user = `${req.database}_${LOGIN_SUFFIX[req.login]}`;
  let conn: Connection;
  try {
    conn = await connect(req.database, user);
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
  const client = conn.client;
  // The API login always runs in a transaction: SET LOCAL ROLE then can't outlive the
  // request on a pooled connection, whatever happens.
  const useTx = req.login === "api" || req.transaction !== false;
  const results: DbResult[] = [];
  let index = -1;
  try {
    if (useTx) await client.query("BEGIN");
    const timeout = Math.max(1000, Math.min(Math.floor(req.statementTimeoutMs ?? 15_000), 300_000));
    await client.query(useTx ? `SET LOCAL statement_timeout = ${timeout}` : `SET statement_timeout = ${timeout}`);
    if (req.login === "api") {
      const role = req.as === "authenticated" ? "plexo_authenticated" : "plexo_anon";
      await client.query(`SET LOCAL ROLE ${role}`);
      await client.query("SELECT set_config('plexo.uid', $1, true), set_config('plexo.role', $2, true), set_config('plexo.email', $3, true)", [
        req.as === "authenticated" ? req.claims?.uid ?? "" : "",
        req.as === "authenticated" ? req.claims?.role ?? "" : "",
        req.as === "authenticated" ? req.claims?.email ?? "" : "",
      ]);
    }
    for (index = 0; index < req.statements.length; index++) {
      const st = req.statements[index];
      const res: any = st.script ? await client.query(st.sql) : await client.query(st.sql, (st.params ?? []) as any[]);
      // A script returns one result per statement inside it; keep the last that has rows.
      const list = Array.isArray(res) ? res : [res];
      const last = [...list].reverse().find((r) => r.fields?.length) ?? list[list.length - 1];
      const max = req.maxRows ?? 5000;
      const rows = (last?.rows ?? []) as Record<string, unknown>[];
      results.push({
        rows: rows.slice(0, max),
        rowCount: last?.rowCount ?? null,
        fields: (last?.fields ?? []).map((f: any) => ({ name: f.name, dataTypeID: f.dataTypeID })),
        truncated: rows.length > max || undefined,
        command: last?.command,
      });
    }
    if (useTx) await client.query("COMMIT");
    return { ok: true, results, durationMs: Date.now() - started };
  } catch (err: any) {
    if (useTx) await client.query("ROLLBACK").catch(() => {});
    if (isConnectionLoss(err)) conn.markBroken();
    if (isConnectionLoss(err) && attempt === 0 && index <= 0) {
      // The pooled connection died (idle timeout, failover, resume) before anything ran.
      return runRequest(req, connect, 1);
    }
    return { ok: false, error: toError(err, index >= 0 ? index : undefined) };
  }
}
