import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError, readBody } from "@/lib/projects/appAccess";
import { ownerContext } from "@/lib/projects/appEnvContext";
import { runQuery, schemaFor } from "@/lib/appRuntime/data";
import { RestError, type Filter, type Order } from "@/lib/appData/rest";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The table grid (spreadsheet view). Runs as the app's owner — sees and edits every row,
 * regardless of row-level security. ?env=dev|live.
 *   GET    ?table&limit&offset&order=col.asc&filter=<json Filter[]>&search=text
 *   POST   { table, rows: [{…}] }                     insert
 *   PATCH  { table, key: { id: … }, values: { … } }   update one row by primary key
 *   DELETE { table, keys: [{ id: … }, …] }            delete rows by primary key
 */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  const ctx = await ownerContext(request, id);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const q = request.nextUrl.searchParams;
    const table = q.get("table") ?? "";
    const filters = q.get("filter") ? (JSON.parse(q.get("filter")!) as Filter[]) : [];
    const order: Order[] = (q.get("order") ?? "").split(",").filter(Boolean).map((o) => {
      const [column, dir] = o.split(".");
      return { column, ascending: dir !== "desc" };
    });
    const search = q.get("search")?.trim();
    let or: string[] = [];
    if (search) {
      const schema = await schemaFor(ctx);
      const textCols = [...(schema.tables.get(table)?.columns.values() ?? [])].filter((c) => /char|text|citext|uuid/.test(c.type)).map((c) => c.name);
      if (textCols.length) or = [textCols.map((c) => `${c}.ilike.*${search.replace(/[,()*"]/g, " ")}*`).join(",")];
    }
    const pk = (await schemaFor(ctx)).tables.get(table)?.primaryKey ?? [];
    const result = await runQuery(ctx, { kind: "service" }, table, {
      action: "select",
      columns: "*",
      filters,
      or,
      order: order.length ? order : pk.map((column) => ({ column, ascending: true })),
      limit: Math.min(Number(q.get("limit")) || 100, 1000),
      offset: Number(q.get("offset")) || 0,
      count: "exact",
    });
    return NextResponse.json({ rows: result.data, total: result.count, primaryKey: pk });
  } catch (err) {
    return appError(err);
  }
}

export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  const ctx = await ownerContext(request, id);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const body = await readBody(request);
    const result = await runQuery(ctx, { kind: "service" }, String(body.table ?? ""), { action: "insert", values: body.rows, returning: true, columns: "*" });
    return NextResponse.json({ rows: result.data });
  } catch (err) {
    return appError(err);
  }
}

function keyFilters(key: unknown): Filter[] {
  if (!key || typeof key !== "object" || Array.isArray(key) || !Object.keys(key).length) throw new RestError("Pass the row's primary key, like { id: 1 }.");
  return Object.entries(key as Record<string, unknown>).map(([column, value]) => ({ column, op: "eq" as const, value }));
}

export async function PATCH(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  const ctx = await ownerContext(request, id);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const body = await readBody(request);
    const result = await runQuery(ctx, { kind: "service" }, String(body.table ?? ""), { action: "update", values: body.values, filters: keyFilters(body.key), returning: true, columns: "*" });
    return NextResponse.json({ rows: result.data });
  } catch (err) {
    return appError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  const ctx = await ownerContext(request, id);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const body = await readBody(request);
    if (!Array.isArray(body.keys) || !body.keys.length || body.keys.length > 500) return NextResponse.json({ error: "Pass 1–500 row keys to delete." }, { status: 400 });
    let deleted = 0;
    for (const key of body.keys) {
      const result = await runQuery(ctx, { kind: "service" }, String(body.table ?? ""), { action: "delete", filters: keyFilters(key) });
      deleted += result.count ?? 0;
    }
    return NextResponse.json({ deleted });
  } catch (err) {
    return appError(err);
  }
}
