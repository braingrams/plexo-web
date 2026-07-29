import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";

// Minimal shared-secret gate for internal/ops endpoints (takedown, cron re-scan) — this
// codebase has no admin-role concept yet, so these routes are not reachable from the
// regular dashboard session at all. Set INTERNAL_ADMIN_TOKEN and call with header
// `x-admin-token: <token>`.
export function isAuthorizedAdmin(request: NextRequest): boolean {
  const expected = process.env.INTERNAL_ADMIN_TOKEN;
  const provided = request.headers.get("x-admin-token");
  if (!expected || !provided) return false; // fail closed if unconfigured

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
