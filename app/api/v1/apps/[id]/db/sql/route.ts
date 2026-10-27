import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError, readBody } from "@/lib/projects/appAccess";
import { ownerContext } from "@/lib/projects/appEnvContext";
import { runOwnerSql, lineAt } from "@/lib/appData/migrations";
import { AppDbError } from "@/lib/appData/db";

/**
 * POST ?env=dev|live { sql } — the SQL editor. Runs as the app's owner in one transaction
 * (new tables get row-level security switched on, as in migrations). Returns the last
 * statement's rows. For lasting schema changes, a migration file is the better home — this
 * is for exploring and one-off fixes.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  const ctx = await ownerContext(request, id);
  if (ctx instanceof NextResponse) return ctx;
  let sql = "";
  try {
    const body = await readBody(request, 500_000);
    sql = typeof body.sql === "string" ? body.sql : "";
    if (!sql.trim()) return NextResponse.json({ error: "Write some SQL to run." }, { status: 400 });
    const started = Date.now();
    const result = await runOwnerSql({ templateId: id, organizationId: ctx.organizationId, env: ctx.env, sql, maxRows: 1000 });
    return NextResponse.json({ rows: result.rows, fields: result.fields, rowCount: result.rowCount, truncated: !!result.truncated, command: result.command, durationMs: Date.now() - started });
  } catch (err) {
    if (err instanceof AppDbError) {
      return NextResponse.json({ error: err.error.message, code: err.error.code, hint: err.error.hint, line: err.error.statementIndex === 1 ? lineAt(sql, err.error.position) : undefined }, { status: 400 });
    }
    return appError(err);
  }
}
