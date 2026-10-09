// A real PostgreSQL 17 for integration tests (embedded-postgres, no system install),
// set up to behave like the Aurora cluster in the ways that matter here: the admin is NOT a
// superuser (like RDS's master user), and an `rds_iam` role exists. App roles log in with a
// test password instead of an IAM token — everything else (provisioning SQL, the gateway's
// transaction/role logic) is the production code.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import type { Connection, Connector } from "@/lambda/app-db/runner";

export const APP_PASSWORD = "test-password";

export type TestPostgres = {
  port: number;
  superQuery(sql: string, database?: string): Promise<pg.QueryResult>;
  adminExec(sql: string, database?: string): Promise<void>;
  /** Gives every login role of an app database the test password. */
  enableLogins(database: string): Promise<void>;
  connector: Connector;
  stop(): Promise<void>;
};

export async function startTestPostgres(): Promise<TestPostgres> {
  const dir = mkdtempSync(join(tmpdir(), "plexo-pg-"));
  const port = 55000 + Math.floor(Math.random() * 4000);
  const server = new EmbeddedPostgres({ databaseDir: dir, port, user: "postgres", password: "postgres", persistent: false, onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();

  const open = async (user: string, password: string, database: string) => {
    const client = new pg.Client({ host: "127.0.0.1", port, user, password, database });
    await client.connect();
    return client;
  };
  const superQuery = async (sql: string, database = "postgres") => {
    const c = await open("postgres", "postgres", database);
    try {
      return await c.query(sql);
    } finally {
      await c.end();
    }
  };
  await superQuery("CREATE ROLE rds_iam NOLOGIN");
  await superQuery("CREATE ROLE plexo_admin LOGIN PASSWORD 'admin' CREATEROLE CREATEDB");
  await superQuery("GRANT rds_iam TO plexo_admin WITH ADMIN OPTION");
  // Trusted extensions need CREATE on the database; on RDS the master has it via rds_superuser.
  await superQuery("GRANT pg_read_all_settings TO plexo_admin");

  const clients = new Map<string, pg.Client>();
  const connector: Connector = async (database, user) => {
    const key = `${database}/${user}`;
    let client = clients.get(key);
    if (!client) {
      client = await open(user, APP_PASSWORD, database);
      clients.set(key, client);
    }
    const conn: Connection = { client, markBroken: () => clients.delete(key) };
    return conn;
  };

  return {
    port,
    superQuery,
    adminExec: async (sql, database = "postgres") => {
      const c = await open("plexo_admin", "admin", database);
      try {
        await c.query(sql);
      } finally {
        await c.end();
      }
    },
    enableLogins: async (database) => {
      for (const login of ["owner", "api", "system"]) await superQuery(`ALTER ROLE "${database}_${login}" PASSWORD '${APP_PASSWORD}'`);
    },
    connector,
    stop: async () => {
      for (const c of clients.values()) await c.end().catch(() => {});
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
