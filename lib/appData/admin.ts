import { RDSDataClient, ExecuteStatementCommand, DatabaseResumingException } from "@aws-sdk/client-rds-data";

// Platform administration of the shared Aurora cluster (creating an app's database and
// roles, installing the plexo schema) through the RDS Data API, as the cluster's admin.
//
// ONLY SQL written by Plexo itself ever runs here — never anything from an app (that runs
// in AppDbFn as the app's own roles; see lib/appData/db.ts). Identifiers interpolated into
// these statements come from databaseName()/roleName(), which only ever produce
// [a-z0-9_].

const RESUME_BUDGET_MS = 45_000;

let rds: RDSDataClient | null = null;
function client(): RDSDataClient {
  if (!rds) rds = new RDSDataClient({ region: process.env.AWS_REGION || "us-east-1", maxAttempts: 3, requestHandler: { requestTimeout: 60_000 } as any });
  return rds;
}

export function clusterConfig(): { clusterArn: string; secretArn: string; clusterId: string } {
  const clusterArn = process.env.APP_DB_CLUSTER_ARN;
  const secretArn = process.env.APP_DB_ADMIN_SECRET_ARN;
  const clusterId = process.env.APP_DB_CLUSTER_ID;
  if (!clusterArn || !secretArn || !clusterId) throw new Error("App databases aren't configured in this environment (APP_DB_CLUSTER_ARN / APP_DB_ADMIN_SECRET_ARN / APP_DB_CLUSTER_ID).");
  return { clusterArn, secretArn, clusterId };
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
export function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
}

/** Runs one admin statement (autocommit), waiting out an auto-paused cluster's wake-up. */
export async function adminExec(sql: string, database = "postgres"): Promise<void> {
  const { clusterArn, secretArn } = clusterConfig();
  const deadline = Date.now() + RESUME_BUDGET_MS;
  let delay = 1500;
  for (;;) {
    try {
      await client().send(new ExecuteStatementCommand({ resourceArn: clusterArn, secretArn, database, sql }));
      return;
    } catch (err) {
      const resuming = err instanceof DatabaseResumingException || (err as any)?.name === "DatabaseResumingException";
      if (resuming && Date.now() + delay < deadline) {
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 8000);
        continue;
      }
      throw err;
    }
  }
}

/** Like adminExec, but treats "already exists" as success — provisioning is re-runnable. */
export async function adminExecIdempotent(sql: string, database = "postgres"): Promise<void> {
  try {
    await adminExec(sql, database);
  } catch (err) {
    if (/already exists|duplicate/i.test(String((err as Error)?.message))) return;
    throw err;
  }
}
