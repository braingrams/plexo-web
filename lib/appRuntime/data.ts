import { AppDatabase } from "@/lib/db/appEntities";
import { runDb } from "@/lib/appData/db";
import { ensureAppDatabase } from "@/lib/appData/provision";
import { getSchema, INTROSPECTION_STATEMENTS, type SchemaInfo } from "@/lib/appData/schema";
import { compileQuery, compileRpc, shapeResult, type QueryState, type Compiled } from "@/lib/appData/rest";
import type { DbRequest } from "@/lib/appData/dbProtocol";
import type { AppContext } from "./context";
import type { AppUserRow } from "@/lib/appAuth/store";

// The data API behind plexo.from(...) and plexo.rpc(...): compile → run as the visitor
// (plexo_anon / plexo_authenticated, so RLS decides) → shape like Supabase. Server
// functions call the same API with the app's service key and run as the owner instead.

export type Caller = { kind: "visitor"; user: AppUserRow | null } | { kind: "service" };

const versions = new Map<string, { version: number; at: number }>();
async function schemaVersion(ctx: AppContext): Promise<number> {
  const hit = versions.get(ctx.database);
  if (hit && Date.now() - hit.at < 10_000) return hit.version;
  await ensureAppDatabase(ctx.templateId, ctx.organizationId, ctx.env);
  const { data } = await AppDatabase.get({ templateId: ctx.templateId, env: ctx.env }).go({ attributes: ["schemaVersion"] });
  const version = data?.schemaVersion ?? 1;
  versions.set(ctx.database, { version, at: Date.now() });
  return version;
}

export async function schemaFor(ctx: AppContext): Promise<SchemaInfo> {
  const version = await schemaVersion(ctx);
  return getSchema(`${ctx.database}:${version}`, () => runDb({ database: ctx.database, login: "owner", statements: INTROSPECTION_STATEMENTS }));
}

function asCaller(ctx: AppContext, caller: Caller): Omit<DbRequest, "statements"> {
  if (caller.kind === "service") return { database: ctx.database, login: "owner" };
  return caller.user
    ? { database: ctx.database, login: "api", as: "authenticated", claims: { uid: caller.user.id, role: caller.user.role, email: caller.user.email } }
    : { database: ctx.database, login: "api", as: "anon" };
}

async function execute(ctx: AppContext, caller: Caller, compiled: Compiled) {
  const [result] = await runDb({ ...asCaller(ctx, caller), statements: [{ sql: compiled.sql, params: compiled.params }], statementTimeoutMs: 15_000, maxRows: 2 });
  return shapeResult(compiled, result.rows[0] as any, result.rowCount);
}

export async function runQuery(ctx: AppContext, caller: Caller, table: string, body: Record<string, any>) {
  const schema = await schemaFor(ctx);
  const state: QueryState = { ...(body as QueryState), table };
  return execute(ctx, caller, compileQuery(schema, state));
}

export async function runRpc(ctx: AppContext, caller: Caller, fn: string, args: Record<string, unknown>) {
  const schema = await schemaFor(ctx);
  return execute(ctx, caller, compileRpc(schema, fn, args));
}

export function forgetSchemaVersion(database: string): void {
  versions.delete(database);
}
