import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/db/appEntities", () => ({ AppDatabase: {} }));

import { provisioningSteps } from "@/lib/appData/provision";
import { wrapOwnerSql } from "@/lib/appData/migrations";
import { INTROSPECTION_STATEMENTS, parseIntrospection, type SchemaInfo } from "@/lib/appData/schema";
import { compileQuery, compileRpc, shapeResult, parseLogic, parseSelect, RestError, type QueryState } from "@/lib/appData/rest";
import { runRequest } from "@/lambda/app-db/runner";
import { startTestPostgres, type TestPostgres } from "./helpers/appPostgres";

// The Supabase-style data API (lib/appData/rest.ts), compiled and executed against a real
// PostgreSQL as real visitors — so results include the effect of row-level security.

const db = `a_${randomUUID().replace(/-/g, "")}_dev`;
const alice = randomUUID();
const bob = randomUUID();
let pgt: TestPostgres;
let schema: SchemaInfo;

async function exec(state: QueryState | { rpc: string; args: Record<string, unknown> }, as: "anon" | string = "anon") {
  const compiled = "rpc" in state ? compileRpc(schema, state.rpc, state.args) : compileQuery(schema, state);
  const res = await runRequest(
    {
      database: db,
      login: "api",
      as: as === "anon" ? "anon" : "authenticated",
      claims: as === "anon" ? undefined : { uid: as, role: "user", email: null },
      statements: [{ sql: compiled.sql, params: compiled.params }],
    },
    pgt.connector,
  );
  if (!res.ok) return { error: res.error };
  return shapeResult(compiled, res.results[0].rows[0] as any, res.results[0].rowCount);
}

const select = (table: string, extra: Partial<QueryState> = {}): QueryState => ({ table, action: "select", columns: "*", ...extra });

beforeAll(async () => {
  pgt = await startTestPostgres();
  for (const step of provisioningSteps(db)) await pgt.adminExec(step.sql, step.database);
  await pgt.enableLogins(db);
  const sys = (sql: string, params: unknown[]) => runRequest({ database: db, login: "system", statements: [{ sql, params }] }, pgt.connector);
  await sys("INSERT INTO plexo.users (id, email) VALUES ($1, 'alice@example.com'), ($2, 'bob@example.com')", [alice, bob]);
  const migration = `
    create table public.profiles (id uuid primary key references plexo.users(id), name text not null);
    create table public.posts (
      id serial primary key,
      author_id uuid not null default plexo.uid() references public.profiles(id),
      title text not null,
      tags text[] not null default '{}',
      meta jsonb not null default '{}',
      published boolean not null default false,
      created_at timestamptz not null default now()
    );
    create table public.comments (id serial primary key, post_id int not null references public.posts(id) on delete cascade, body text not null, approved boolean not null default true);
    create policy "profiles are public" on public.profiles for select to plexo_anon, plexo_authenticated using (true);
    create policy "published posts are public" on public.posts for select to plexo_anon, plexo_authenticated using (published or author_id = plexo.uid());
    create policy "authors write their posts" on public.posts for insert to plexo_authenticated with check (author_id = plexo.uid());
    create policy "authors edit their posts" on public.posts for update to plexo_authenticated using (author_id = plexo.uid());
    create policy "authors delete their posts" on public.posts for delete to plexo_authenticated using (author_id = plexo.uid());
    create policy "comments are public" on public.comments for select to plexo_anon, plexo_authenticated using (true);
    create function public.post_count(only_published boolean default true) returns int language sql stable as
      'select count(*)::int from public.posts where published or not only_published';
    create function public.search_posts(term text) returns setof public.posts language sql stable as
      'select * from public.posts where title ilike ''%'' || term || ''%''';
    insert into public.profiles values ('${alice}', 'Alice'), ('${bob}', 'Bob');
    insert into public.posts (author_id, title, tags, meta, published) values
      ('${alice}', 'Hello world', '{intro,news}', '{"plan":"pro"}', true),
      ('${alice}', 'Draft idea', '{}', '{}', false),
      ('${bob}', 'Bob says hi', '{news}', '{"plan":"free"}', true);
    insert into public.comments (post_id, body, approved) values (1, 'Nice!', true), (1, 'Spam', false), (3, 'Hey Bob', true);
  `;
  const res = await runRequest({ database: db, login: "owner", statements: wrapOwnerSql(migration) }, pgt.connector);
  if (!res.ok) throw new Error(res.error.message);
  const intro = await runRequest({ database: db, login: "owner", statements: INTROSPECTION_STATEMENTS }, pgt.connector);
  if (!intro.ok) throw new Error(intro.error.message);
  schema = parseIntrospection(intro.results);
}, 120_000);

afterAll(async () => {
  await pgt?.stop();
});

describe("parsing", () => {
  it("reads select lists with aliases, JSON paths, casts and embeds", () => {
    expect(parseSelect("id, author:profiles(name), meta->>plan, created_at::date, comments!inner(count)")).toEqual([
      { kind: "column", column: "id", path: [], arrow: [], alias: "id", cast: undefined },
      { kind: "embed", relation: "profiles", hint: undefined, inner: false, alias: "author", items: [{ kind: "column", column: "name", path: [], arrow: [], alias: "name", cast: undefined }] },
      { kind: "column", column: "meta", path: ["plan"], arrow: ["->>"], alias: "plan", cast: undefined },
      { kind: "column", column: "created_at", path: [], arrow: [], alias: "created_at", cast: "date" },
      { kind: "embed", relation: "comments", hint: undefined, inner: true, alias: "comments", items: [{ kind: "count", alias: "count" }] },
    ]);
  });

  it("reads PostgREST or() expressions", () => {
    expect(parseLogic('status.eq.open,and(priority.gte.3,owner.in.(a,"b,c")),title.ilike.*fix*')).toEqual({
      kind: "or",
      negate: false,
      children: [
        { kind: "filter", filter: { column: "status", op: "eq", value: "open", negate: false } },
        { kind: "and", negate: false, children: [
          { kind: "filter", filter: { column: "priority", op: "gte", value: "3", negate: false } },
          { kind: "filter", filter: { column: "owner", op: "in", value: ["a", "b,c"], negate: false } },
        ] },
        { kind: "filter", filter: { column: "title", op: "ilike", value: "%fix%", negate: false } },
      ],
    });
  });
});

describe("reading", () => {
  it("applies RLS: signed-out visitors see published posts only", async () => {
    const r = await exec(select("posts", { columns: "title", order: [{ column: "id", ascending: true }] }));
    expect(r).toEqual({ data: [{ title: "Hello world" }, { title: "Bob says hi" }], count: null });
  });

  it("authors also see their own drafts", async () => {
    const r: any = await exec(select("posts", { columns: "title", filters: [{ column: "author_id", op: "eq", value: alice }], order: [{ column: "id", ascending: true }] }), alice);
    expect(r.data.map((p: any) => p.title)).toEqual(["Hello world", "Draft idea"]);
  });

  it("embeds related rows both ways, with filters on the embed, counts and !inner", async () => {
    const r: any = await exec(select("posts", {
      columns: "title, author:profiles(name), comments(body), total:comments(count)",
      filters: [{ column: "comments.approved", op: "eq", value: true }],
      order: [{ column: "id", ascending: true }],
    }));
    // The filter targets the embed named "comments"; the aliased "total" embed is unfiltered
    // (PostgREST semantics), so it counts both comments.
    expect(r.data[0]).toEqual({ title: "Hello world", author: { name: "Alice" }, comments: [{ body: "Nice!" }], total: [{ count: 2 }] });
    const inner: any = await exec(select("profiles", { columns: "name, posts!inner(title)", filters: [{ column: "posts.title", op: "ilike", value: "%bob%" }] }));
    expect(inner.data).toEqual([{ name: "Bob", posts: [{ title: "Bob says hi" }] }]);
  });

  it("filters on arrays, JSON paths, lists, text search and or()", async () => {
    const tags: any = await exec(select("posts", { columns: "title", filters: [{ column: "tags", op: "contains", value: ["news"] }], order: [{ column: "id", ascending: true }] }));
    expect(tags.data.map((p: any) => p.title)).toEqual(["Hello world", "Bob says hi"]);
    const json: any = await exec(select("posts", { columns: "title", filters: [{ column: "meta->>plan", op: "eq", value: "pro" }] }));
    expect(json.data).toEqual([{ title: "Hello world" }]);
    const list: any = await exec(select("posts", { columns: "id", filters: [{ column: "id", op: "in", value: [1, 3] }], order: [{ column: "id", ascending: false }] }));
    expect(list.data).toEqual([{ id: 3 }, { id: 1 }]);
    const fts: any = await exec(select("posts", { columns: "title", filters: [{ column: "title", op: "textSearch", value: "world" }] }));
    expect(fts.data).toEqual([{ title: "Hello world" }]);
    const or: any = await exec(select("posts", { columns: "id", or: ["title.ilike.*bob*,meta->>plan.eq.pro"], order: [{ column: "id", ascending: true }] }));
    expect(or.data).toEqual([{ id: 1 }, { id: 3 }]);
  });

  it("counts, ranges and single rows", async () => {
    const page: any = await exec(select("posts", { columns: "id", count: "exact", limit: 1, offset: 1, order: [{ column: "id", ascending: true }] }));
    expect(page).toEqual({ data: [{ id: 3 }], count: 2 });
    const head: any = await exec(select("posts", { count: "exact", head: true }));
    expect(head).toEqual({ data: null, count: 2 });
    const one: any = await exec(select("posts", { columns: "title", filters: [{ column: "id", op: "eq", value: 3 }], single: "single" }));
    expect(one.data).toEqual({ title: "Bob says hi" });
    const none: any = await exec(select("posts", { filters: [{ column: "id", op: "eq", value: 999 }], single: "maybeSingle" }));
    expect(none.data).toBeNull();
    await expect(exec(select("posts", { single: "single" }))).rejects.toThrow(/more than one/);
  });

  it("explains unknown tables, columns and relations", async () => {
    expect(() => compileQuery(schema, select("post"))).toThrow(/doesn't exist[\s\S]*/);
    try {
      compileQuery(schema, select("Posts"));
    } catch (e) {
      expect((e as RestError).hint).toContain('"posts"');
    }
    expect(() => compileQuery(schema, select("posts", { columns: "titel" }))).toThrow(/column "titel" doesn't exist/);
    expect(() => compileQuery(schema, select("comments", { columns: "*, profiles(name)" }))).toThrow(/no relationship/);
  });
});

describe("writing", () => {
  it("inserts as the signed-in author and returns the row with relations", async () => {
    const r: any = await exec({ table: "posts", action: "insert", values: { title: "New post", tags: ["a", "b"], meta: { x: 1 } }, returning: true, columns: "title, tags, meta, author:profiles(name)", single: "single" }, bob);
    expect(r.data).toEqual({ title: "New post", tags: ["a", "b"], meta: { x: 1 }, author: { name: "Bob" } });
  });

  it("refuses writes RLS doesn't allow, and signed-out writes entirely", async () => {
    const forged: any = await exec({ table: "posts", action: "insert", values: { title: "Forged", author_id: alice } }, bob);
    expect(forged.error.code).toBe("42501");
    const anon: any = await exec({ table: "posts", action: "insert", values: { title: "Anon" } });
    expect(anon.error).toBeTruthy();
  });

  it("updates and deletes only rows the visitor may touch", async () => {
    const mine: any = await exec({ table: "posts", action: "update", values: { published: true }, filters: [{ column: "title", op: "eq", value: "New post" }] }, bob);
    expect(mine).toEqual({ data: null, count: 1 });
    const theirs: any = await exec({ table: "posts", action: "update", values: { title: "Hacked" }, filters: [{ column: "author_id", op: "eq", value: alice }] }, bob);
    expect(theirs).toEqual({ data: null, count: 0 });
    const del: any = await exec({ table: "posts", action: "delete", filters: [{ column: "title", op: "eq", value: "New post" }] }, bob);
    expect(del).toEqual({ data: null, count: 1 });
  });

  it("upserts on the primary key or a named conflict column", async () => {
    const r: any = await exec({ table: "posts", action: "upsert", values: [{ id: 3, title: "Bob says hello" }], returning: true, columns: "id, title" }, bob);
    expect(r.data).toEqual([{ id: 3, title: "Bob says hello" }]);
  });

  it("never updates or deletes without a filter", () => {
    expect(() => compileQuery(schema, { table: "posts", action: "delete" })).toThrow(/every row/);
    expect(() => compileQuery(schema, { table: "posts", action: "update", values: { title: "x" } })).toThrow(/every row/);
  });
});

describe("rpc", () => {
  it("calls scalar and set-returning functions with named, typed arguments", async () => {
    expect(await exec({ rpc: "post_count", args: {} })).toEqual({ data: 2, count: null });
    expect(await exec({ rpc: "post_count", args: { only_published: false } }, alice)).toMatchObject({ data: 3 });
    const found: any = await exec({ rpc: "search_posts", args: { term: "bob" } });
    expect(found.data.map((p: any) => p.title)).toEqual(["Bob says hello"]);
    expect(() => compileRpc(schema, "post_count", { nope: 1 })).toThrow(/takes those arguments/);
  });
});
