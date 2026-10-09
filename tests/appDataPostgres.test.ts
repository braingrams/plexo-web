import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
// Only the pure SQL builders are used here; the DynamoDB bookkeeping around them isn't.
vi.mock("@/lib/db/appEntities", () => ({ AppDatabase: {} }));

import { provisioningSteps } from "@/lib/appData/provision";
import { wrapOwnerSql } from "@/lib/appData/migrations";
import { runRequest } from "@/lambda/app-db/runner";
import type { DbRequest } from "@/lib/appData/dbProtocol";
import { startTestPostgres, type TestPostgres } from "./helpers/appPostgres";

// The security model of app databases, against a real PostgreSQL: provisioning SQL,
// row-level security on by default, the gateway's role switching, and isolation between
// apps. See docs/plexo-projects/ARCHITECTURE.md §5.

const dbA = `a_${randomUUID().replace(/-/g, "")}_dev`;
const dbB = `a_${randomUUID().replace(/-/g, "")}_dev`;
let pgt: TestPostgres;

const run = (req: DbRequest) => runRequest(req, pgt.connector);
async function ok(req: DbRequest) {
  const res = await run(req);
  if (!res.ok) throw new Error(`${res.error.code ?? ""} ${res.error.message}`);
  return res.results;
}

async function provision(database: string) {
  for (const step of provisioningSteps(database)) {
    try {
      await pgt.adminExec(step.sql, step.database);
    } catch (err) {
      if (!(step.ignoreExists && /already exists/.test(String((err as Error).message)))) throw err;
    }
  }
}

const userA = randomUUID();
const userB = randomUUID();

beforeAll(async () => {
  pgt = await startTestPostgres();
  await provision(dbA);
  await provision(dbB);
  await pgt.enableLogins(dbA);
  await pgt.enableLogins(dbB);
  for (const [id, email] of [[userA, "a@example.com"], [userB, "b@example.com"]]) {
    await ok({ database: dbA, login: "system", statements: [{ sql: "INSERT INTO plexo.users (id, email) VALUES ($1, $2)", params: [id, email] }] });
  }
}, 120_000);

afterAll(async () => {
  await pgt?.stop();
});

const migration = `
BEGIN;
create table public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default plexo.uid() references plexo.users(id) on delete cascade,
  title text not null,
  done boolean not null default false
);
create policy "own todos read" on public.todos for select to plexo_authenticated using (user_id = plexo.uid());
create policy "own todos write" on public.todos for insert to plexo_authenticated with check (user_id = plexo.uid());
create table public.announcements (id serial primary key, body text not null);
alter table public.announcements disable row level security;
COMMIT;
`;

describe("provisioning", () => {
  it("is re-runnable", async () => {
    await expect(provision(dbA)).resolves.toBeUndefined();
  });

  // On Aurora every app login is in rds_iam, and any role that inherits rds_iam must sign in
  // with IAM — so if plexo_admin inherited an app role, its password (which the Data API uses)
  // would stop working cluster-wide. Provisioning runs as plexo_admin here, as it does there.
  it("never lets the admin inherit an app's roles", async () => {
    const { rows } = await pgt.superQuery(`
      SELECT r.rolname, m.inherit_option FROM pg_auth_members m
      JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
      WHERE u.rolname = 'plexo_admin' AND r.rolname LIKE 'a\\_%'`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.inherit_option)).toEqual([]);
  });

  it("installs the plexo schema with the helper functions", async () => {
    const [r] = await ok({ database: dbA, login: "owner", statements: [{ sql: "SELECT plexo.uid() AS uid, to_regclass('plexo.users') IS NOT NULL AS users" }] });
    expect(r.rows[0]).toEqual({ uid: null, users: true });
  });
});

describe("migrations as the owner", () => {
  it("apply atomically, enable RLS on new tables, and respect an explicit opt-out", async () => {
    await ok({ database: dbA, login: "owner", statements: wrapOwnerSql(migration, { name: "0001_init.sql", checksum: "x" }) });
    const [r] = await ok({
      database: dbA,
      login: "owner",
      statements: [{ sql: "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('todos', 'announcements') ORDER BY relname" }],
    });
    expect(r.rows).toEqual([
      { relname: "announcements", relrowsecurity: false },
      { relname: "todos", relrowsecurity: true },
    ]);
    const [m] = await ok({ database: dbA, login: "owner", statements: [{ sql: "SELECT name FROM plexo.migrations" }] });
    expect(m.rows).toEqual([{ name: "0001_init.sql" }]);
  });

  it("roll back entirely when any statement fails", async () => {
    const res = await run({ database: dbA, login: "owner", statements: wrapOwnerSql("create table public.half (id int); select * from nope;", { name: "0002_bad.sql", checksum: "y" }) });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.statementIndex).toBe(1);
    const [r] = await ok({ database: dbA, login: "owner", statements: [{ sql: "SELECT to_regclass('public.half') AS t, (SELECT count(*) FROM plexo.migrations) AS n" }] });
    expect(r.rows[0]).toEqual({ t: null, n: 1 });
  });
});

describe("row-level security through the gateway", () => {
  const asUser = (uid: string, sql: string, params: unknown[] = []): DbRequest => ({
    database: dbA,
    login: "api",
    as: "authenticated",
    claims: { uid, role: "user", email: null },
    statements: [{ sql, params }],
  });

  it("each visitor sees and writes only their own rows", async () => {
    await ok(asUser(userA, "INSERT INTO public.todos (title) VALUES ('A1')"));
    await ok(asUser(userB, "INSERT INTO public.todos (title) VALUES ('B1')"));
    const [a] = await ok(asUser(userA, "SELECT title FROM public.todos"));
    expect(a.rows).toEqual([{ title: "A1" }]);
    const forged = await run(asUser(userA, "INSERT INTO public.todos (title, user_id) VALUES ('forged', $1)", [userB]));
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.error.code).toBe("42501");
  });

  it("signed-out visitors see nothing without a policy for them", async () => {
    const [r] = await ok({ database: dbA, login: "api", as: "anon", statements: [{ sql: "SELECT count(*)::int AS n FROM public.todos" }] });
    expect(r.rows[0]).toEqual({ n: 0 });
  });

  it("a visitor can't read accounts or escalate to the owner", async () => {
    const users = await run(asUser(userA, "SELECT email FROM plexo.users"));
    expect(users.ok).toBe(false);
    for (const sql of [`SET ROLE "${dbA}_owner"`, `SELECT set_config('role', '${dbA}_owner', true)`, "RESET ROLE; SELECT * FROM plexo.users"]) {
      const res = await run(asUser(userA, sql));
      expect(res.ok, sql).toBe(false);
    }
  });

  it("the owner can read accounts but not change them", async () => {
    const [r] = await ok({ database: dbA, login: "owner", statements: [{ sql: "SELECT count(*)::int AS n FROM plexo.users" }] });
    expect(r.rows[0]).toEqual({ n: 2 });
    const res = await run({ database: dbA, login: "owner", statements: [{ sql: "UPDATE plexo.users SET role = 'admin'" }] });
    expect(res.ok).toBe(false);
  });
});

describe("isolation between apps", () => {
  it("one app's logins can't connect to another app's database", async () => {
    const crossOwner = await runRequest({ database: dbB, login: "owner", statements: [{ sql: "SELECT 1" }] }, (database, user) =>
      pgt.connector(database, user.replace(dbB, dbA)),
    );
    expect(crossOwner.ok).toBe(false);
    expect(!crossOwner.ok && crossOwner.error.message).toMatch(/permission denied|not permitted/i);
  });

  it("an app's owner can't touch cluster roles", async () => {
    const res = await run({ database: dbA, login: "owner", statements: [{ sql: `ALTER ROLE "${dbB}_owner" PASSWORD 'x'` }] });
    expect(res.ok).toBe(false);
    const grant = await run({ database: dbA, login: "owner", statements: [{ sql: `GRANT plexo_authenticated TO "${dbA}_owner"` }] });
    expect(grant.ok).toBe(false);
  });
});

describe("limits", () => {
  it("stops a runaway query at the statement timeout", async () => {
    const res = await run({ database: dbA, login: "owner", statementTimeoutMs: 1000, statements: [{ sql: "SELECT pg_sleep(3)" }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("timeout");
  }, 10_000);
});
