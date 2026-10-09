import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import type { DbRequest, DbResponse, DbError, DbResult } from "./dbProtocol";
import type { AppEnv } from "@/lib/db/appEntities";

// Runs SQL in an app's database through AppDbFn (lambda/app-db). The database auto-pauses
// to 0 ACU when idle; a request that arrives while it's paused waits for it to wake. AppDbFn
// waits up to 30 s for its connection, and if the database still isn't up this retries
// within an overall budget, so a visitor sees a slow first request — never an error — after
// a quiet period.

const RESUME_BUDGET_MS = 40_000;

let lambda: LambdaClient | null = null;
function client(): LambdaClient {
  // The SDK's default socket timeout is far longer than any query; keep the call itself
  // bounded just above AppDbFn's own timeout.
  if (!lambda) lambda = new LambdaClient({ region: process.env.AWS_REGION || "us-east-1", maxAttempts: 2, requestHandler: { requestTimeout: 65_000 } as any });
  return lambda;
}

export class AppDbError extends Error {
  constructor(public readonly error: DbError) {
    super(error.message);
  }
}

export class AppDbUnavailableError extends Error {}

export function databaseName(templateId: string, env: AppEnv): string {
  const id = templateId.replace(/-/g, "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("Unexpected app id.");
  return `a_${id}_${env}`;
}

export async function runDb(request: DbRequest): Promise<DbResult[]> {
  const fn = process.env.APP_DB_FUNCTION_NAME;
  if (!fn) throw new AppDbUnavailableError("App databases aren't available in this environment yet (APP_DB_FUNCTION_NAME isn't set).");
  const deadline = Date.now() + RESUME_BUDGET_MS;
  let delay = 1000;
  for (;;) {
    const res = await client().send(new InvokeCommand({ FunctionName: fn, Payload: Buffer.from(JSON.stringify(request)) }));
    if (res.FunctionError) {
      const text = res.Payload ? Buffer.from(res.Payload).toString("utf8") : "";
      throw new AppDbError({ message: `The database service failed (${res.FunctionError}). ${text.slice(0, 300)}`, kind: "connection" });
    }
    const body = JSON.parse(Buffer.from(res.Payload!).toString("utf8")) as DbResponse;
    if (body.ok) return body.results;
    const retryable = body.error.kind === "resuming" || (body.error.kind === "connection" && !body.error.code);
    if (retryable && Date.now() + delay < deadline) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 8000);
      continue;
    }
    throw new AppDbError(body.error);
  }
}

/** Single statement convenience: rows of the one statement. */
export async function queryDb<T = Record<string, unknown>>(request: Omit<DbRequest, "statements">, sql: string, params: unknown[] = []): Promise<T[]> {
  const [result] = await runDb({ ...request, statements: [{ sql, params }] });
  return result.rows as T[];
}
