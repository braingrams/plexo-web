// AppDbFn — runs an app's SQL against its own Aurora database, from inside the database VPC.
// Invoked only by Plexo's own app server (IAM: lambda:InvokeFunction), never from outside.
//
// It connects as one of the app database's own login roles (docs/plexo-projects/
// ARCHITECTURE.md §5) using IAM database authentication: no passwords exist anywhere, and
// this function's IAM policy only allows rds-db:connect as app roles ("a_*"), never as the
// platform's admin — so even arbitrary SQL from an app's migration can't reach another app.
//
// Connections are reused across warm invocations, but the database closes any session idle
// for 60 s (cluster parameter idle_session_timeout) so the cluster can still auto-pause to
// 0 ACU; a connection found dead is simply reopened (runner.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { Signer } from "@aws-sdk/rds-signer";
import type { DbRequest, DbResponse } from "../../lib/appData/dbProtocol";
import { runRequest, type Connection } from "./runner";

const HOST = process.env.APP_DB_HOST!;
const PORT = Number(process.env.APP_DB_PORT || 5432);
const REGION = process.env.AWS_REGION || "us-east-1";
// AWS's RDS CA bundle ships with the function (copied in by CDK bundling), so the
// database's certificate is actually verified.
const CA = readFileSync(join(__dirname, "rds-global-bundle.pem"), "utf8");

// A paused cluster resumes when a connection arrives; the attempt waits for it (~15 s).
const CONNECT_TIMEOUT_MS = 30_000;
const MAX_POOLED = 12;

type Pooled = { client: pg.Client; key: string; lastUsed: number; broken: boolean };
const pool = new Map<string, Pooled>();
const tokens = new Map<string, { token: string; expires: number }>();

async function authToken(user: string): Promise<string> {
  const cached = tokens.get(user);
  if (cached && cached.expires > Date.now()) return cached.token;
  const token = await new Signer({ hostname: HOST, port: PORT, username: user, region: REGION }).getAuthToken();
  tokens.set(user, { token, expires: Date.now() + 10 * 60 * 1000 }); // tokens live 15 min
  return token;
}

async function connect(database: string, user: string): Promise<Connection> {
  const key = `${database}/${user}`;
  let entry = pool.get(key);
  if (entry?.broken) {
    pool.delete(key);
    entry.client.end().catch(() => {});
    entry = undefined;
  }
  if (!entry) {
    if (pool.size >= MAX_POOLED) {
      const oldest = [...pool.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0];
      pool.delete(oldest.key);
      oldest.client.end().catch(() => {});
    }
    const client = new pg.Client({
      host: HOST,
      port: PORT,
      database,
      user,
      password: await authToken(user),
      ssl: { ca: CA, rejectUnauthorized: true },
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      application_name: "plexo-app-db",
    });
    const created: Pooled = { client, key, lastUsed: Date.now(), broken: false };
    client.on("error", () => (created.broken = true));
    client.on("end", () => (created.broken = true));
    await client.connect();
    pool.set(key, created);
    entry = created;
  }
  entry.lastUsed = Date.now();
  const current = entry;
  return { client: current.client, markBroken: () => (current.broken = true) };
}

export async function handler(event: DbRequest): Promise<DbResponse> {
  return runRequest(event, connect);
}
