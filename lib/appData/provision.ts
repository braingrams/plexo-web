import { AppDatabase, type AppEnv } from "@/lib/db/appEntities";
import { adminExec, adminExecIdempotent, clusterConfig, ident } from "./admin";
import { databaseName } from "./db";

// Creates an app's database on first use — nothing to set up by hand. Every step is
// idempotent, so a provisioning attempt interrupted halfway (Lambda timeout, cluster
// resuming) simply runs again.
//
// Per database "a_<id>_<env>" there are three login roles, all IAM-authenticated:
//   _owner   owns the database and the app's tables (migrations, SQL editor, functions)
//   _api     the REST gateway — may only SET ROLE to plexo_anon / plexo_authenticated
//   _system  owns the plexo schema (visitor accounts, sessions, migration history)
// plexo_anon / plexo_authenticated are cluster-wide NOLOGIN roles; what they can touch is
// decided per database by grants and row-level-security policies.

export const roleName = (database: string, login: "owner" | "api" | "system") => `${database}_${login}`;

const EXTENSIONS = ["pgcrypto", "citext", "pg_trgm", "uuid-ossp", "unaccent", "vector"];

export async function ensureAppDatabase(templateId: string, organizationId: string, env: AppEnv): Promise<{ database: string }> {
  const database = databaseName(templateId, env);
  const { data: existing } = await AppDatabase.get({ templateId, env }).go();
  if (existing?.status === "READY") return { database };

  const { clusterId } = clusterConfig();
  if (!existing) {
    await AppDatabase.create({ templateId, env, organizationId, clusterId, database, status: "PROVISIONING" }).go().catch(() => undefined);
  }
  try {
    await provisionDatabase(database);
    await AppDatabase.patch({ templateId, env }).set({ status: "READY", statusMessage: "" }).go();
  } catch (err) {
    await AppDatabase.patch({ templateId, env }).set({ status: "FAILED", statusMessage: String((err as Error)?.message ?? err).slice(0, 500) }).go().catch(() => undefined);
    throw new Error("Plexo couldn't set up this app's database. Please try again in a minute — if it keeps happening, contact support.");
  }
  return { database };
}

/** Permanently removes an app database and its logins (the app is being deleted). */
export async function dropAppDatabase(templateId: string, env: AppEnv): Promise<void> {
  const { data } = await AppDatabase.get({ templateId, env }).go();
  if (!data) return;
  const database = databaseName(templateId, env);
  // FORCE disconnects any open session (a warm AppDbFn connection) first.
  await adminExec(`DROP DATABASE IF EXISTS ${ident(database)} WITH (FORCE)`);
  for (const login of ["owner", "api", "system"] as const) {
    await adminExec(`DROP ROLE IF EXISTS ${ident(roleName(database, login))}`);
  }
  await AppDatabase.delete({ templateId, env }).go();
}

async function provisionDatabase(database: string): Promise<void> {
  for (const step of provisioningSteps(database)) {
    if (step.ignoreExists) await adminExecIdempotent(step.sql, step.database);
    else await adminExec(step.sql, step.database);
  }
}

export type ProvisioningStep = { sql: string; database: string; ignoreExists?: boolean };

/** The admin statements that create one app database, in order. Pure, so the exact SQL is
 * tested against a real Postgres (tests/appDataPostgres.test.ts). */
export function provisioningSteps(database: string): ProvisioningStep[] {
  const steps: ProvisioningStep[] = [];
  const step = (sql: string, db = "postgres") => steps.push({ sql, database: db });
  const stepIgnoringExists = (sql: string, db = "postgres") => steps.push({ sql, database: db, ignoreExists: true });
  const db = ident(database);
  const owner = roleName(database, "owner");
  const api = roleName(database, "api");
  const system = roleName(database, "system");

  // Cluster-wide client roles (once per cluster) and this database's three logins.
  step(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plexo_anon') THEN CREATE ROLE plexo_anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plexo_authenticated') THEN CREATE ROLE plexo_authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${owner}') THEN
      CREATE ROLE ${ident(owner)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 15; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${api}') THEN
      CREATE ROLE ${ident(api)} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 40; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${system}') THEN
      CREATE ROLE ${ident(system)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 10; END IF;
  END $$`);
  step(`GRANT rds_iam TO ${ident(owner)}, ${ident(api)}, ${ident(system)}`);
  step(`GRANT plexo_anon, plexo_authenticated TO ${ident(api)}`);
  // The admin must be a member of the owner role to create a database owned by it.
  step(`GRANT ${ident(owner)}, ${ident(system)} TO CURRENT_USER`);
  stepIgnoringExists(`CREATE DATABASE ${db} OWNER ${ident(owner)}`);
  step(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
  step(`GRANT CONNECT ON DATABASE ${db} TO ${ident(api)}, ${ident(system)}`);

  // Inside the new database.
  // Each extension on its own: one the cluster's engine version doesn't offer must not stop
  // the database from being created.
  step(
    `DO $$ BEGIN ${EXTENSIONS.map((e) => `BEGIN CREATE EXTENSION IF NOT EXISTS "${e}"; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'extension ${e} unavailable'; END;`).join(" ")} END $$`,
    database,
  );
  step(`DO $$ BEGIN
    CREATE SCHEMA IF NOT EXISTS plexo AUTHORIZATION ${ident(system)};
    EXECUTE 'SET LOCAL ROLE ${system}';

    CREATE TABLE IF NOT EXISTS plexo.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email citext NOT NULL UNIQUE,
      email_confirmed_at timestamptz,
      password_hash text,
      role text NOT NULL DEFAULT 'user' CHECK (role ~ '^[a-z][a-z0-9_-]{0,31}$'),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      disabled_at timestamptz,
      last_sign_in_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS plexo.identities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES plexo.users(id) ON DELETE CASCADE,
      provider text NOT NULL,
      provider_user_id text NOT NULL,
      email citext,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (provider, provider_user_id)
    );
    CREATE INDEX IF NOT EXISTS identities_user_id ON plexo.identities (user_id);
    CREATE TABLE IF NOT EXISTS plexo.sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES plexo.users(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      user_agent text,
      ip_hash text
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id ON plexo.sessions (user_id);
    CREATE TABLE IF NOT EXISTS plexo.tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      purpose text NOT NULL,
      token_hash text NOT NULL UNIQUE,
      user_id uuid REFERENCES plexo.users(id) ON DELETE CASCADE,
      email citext,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS plexo.migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      duration_ms integer
    );

    CREATE OR REPLACE FUNCTION plexo.uid() RETURNS uuid LANGUAGE sql STABLE
      AS 'SELECT nullif(current_setting(''plexo.uid'', true), '''')::uuid';
    CREATE OR REPLACE FUNCTION plexo.role() RETURNS text LANGUAGE sql STABLE
      AS 'SELECT nullif(current_setting(''plexo.role'', true), '''')';
    CREATE OR REPLACE FUNCTION plexo.email() RETURNS text LANGUAGE sql STABLE
      AS 'SELECT nullif(current_setting(''plexo.email'', true), '''')';

    GRANT USAGE ON SCHEMA plexo TO ${ident(owner)}, plexo_anon, plexo_authenticated;
    GRANT EXECUTE ON FUNCTION plexo.uid(), plexo.role(), plexo.email() TO ${ident(owner)}, plexo_anon, plexo_authenticated;
    -- The app's own tables may reference accounts (foreign keys) and read them in server
    -- code; only Plexo's auth code (the system role) can change them.
    GRANT SELECT, REFERENCES ON plexo.users TO ${ident(owner)};
    GRANT SELECT, INSERT ON plexo.migrations TO ${ident(owner)};
  END $$`, database);

  // What the two client roles may do with the app's tables. Row-level security (switched
  // on for every new table — see migrations.ts) still decides which rows.
  step(`DO $$ BEGIN
    GRANT USAGE ON SCHEMA public TO plexo_anon, plexo_authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(owner)} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO plexo_anon, plexo_authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(owner)} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO plexo_anon, plexo_authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(owner)} IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO plexo_anon, plexo_authenticated;
  END $$`, database);
  return steps;
}
