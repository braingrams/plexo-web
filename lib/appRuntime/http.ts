import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { AppDbError, AppDbUnavailableError } from "@/lib/appData/db";
import { RestError } from "@/lib/appData/rest";
import { AuthError } from "@/lib/appAuth/service";

// Response helpers shared by the runtime API (app/api/runtime/[domain]/[[...path]]).
// Every error body is { error: { message, code?, hint? } } with a message a visitor or an
// app owner can act on.

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function ok(data: unknown, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): NextResponse {
  return json({ data, ...extra }, 200, headers);
}

export function fail(status: number, message: string, code?: string, hint?: string): NextResponse {
  return json({ error: { message, ...(code ? { code } : {}), ...(hint ? { hint } : {}) } }, status);
}

/** Postgres errors, translated (SQLSTATE → plain language + what to do). */
function dbFailure(err: AppDbError): NextResponse {
  const e = err.error;
  switch (e.code) {
    case "42501":
      return fail(403, "You don't have permission to do that.", "permission_denied",
        "Row-level security blocked this. Add a policy to the table in a migration (for example: create policy … for select to plexo_authenticated using (user_id = plexo.uid())).");
    case "23505":
      return fail(409, `That ${(e.detail?.match(/Key \(([^)]+)\)/)?.[1] ?? "value").replace(/_/g, " ")} is already taken.`, "duplicate");
    case "23503":
      return fail(409, "That refers to something that doesn't exist (or is still in use elsewhere).", "foreign_key", e.detail);
    case "23502":
      return fail(400, `${(e.message.match(/column "([^"]+)"/)?.[1] ?? "A field").replace(/_/g, " ")} is required.`, "not_null");
    case "23514":
      return fail(400, "One of the values isn't allowed.", "check_violation", e.detail ?? e.message);
    case "22P02":
    case "22007":
    case "22008":
      return fail(400, "One of the values is in the wrong format.", "invalid_value", e.message);
    case "42P01":
    case "42703":
    case "42883":
      return fail(400, e.message, "schema_mismatch", "The app's code and its database don't match. Check the table/column names, or rebuild so the latest migrations are applied.");
  }
  if (e.kind === "timeout") return fail(504, e.message, "timeout", "Add an index for the columns you filter on, or fetch fewer rows.");
  if (e.kind === "resuming" || e.kind === "connection") return fail(503, "The app's database is starting up — please try again in a few seconds.", "database_starting");
  return fail(400, e.message, e.code, e.hint);
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof RestError) return fail(err.status, err.message, "invalid_request", err.hint);
  if (err instanceof AuthError) return fail(err.status, err.message, err.code);
  if (err instanceof AppDbError) return dbFailure(err);
  if (err instanceof AppDbUnavailableError) return fail(503, "This app's backend isn't available right now.", "unavailable");
  console.error("Runtime API error", err);
  return fail(500, "Something went wrong. Please try again.", "internal");
}

export async function readJson(request: Request, maxBytes = 1_000_000): Promise<Record<string, any>> {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > maxBytes) throw new RestError(`The request is too large (over ${Math.round(maxBytes / 1000)} KB).`, 413);
  const text = await request.text();
  if (text.length > maxBytes) throw new RestError(`The request is too large (over ${Math.round(maxBytes / 1000)} KB).`, 413);
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object") throw new Error();
    return value;
  } catch {
    throw new RestError("The request body must be JSON.");
  }
}

export function requestMeta(request: Request): { ipHash: string; userAgent: string | null } {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "0.0.0.0";
  return { ipHash: createHash("sha256").update(ip).digest("hex"), userAgent: request.headers.get("user-agent") };
}

// Coarse per-instance throttle for the data API (per app + client). DynamoDB-backed limits
// guard the auth endpoints; this just stops one client hammering an app's database.
const buckets = new Map<string, { tokens: number; at: number }>();
export function throttle(key: string, perMinute: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 20_000) buckets.delete(buckets.keys().next().value!);
  return true;
}
