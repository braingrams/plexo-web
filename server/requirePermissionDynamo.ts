import { NextResponse } from "next/server";

import { roles, type OrgRole } from "@/server/accessControl";

type PermissionMap = Record<string, string[]>;

/**
 * DynamoDB-stack replacement for requirePermission.ts's auth.api.hasPermission call.
 * better-auth's org plugin exposed hasPermission as an HTTP-style API, but the actual
 * check underneath was always this: roles[role].authorize(permission), a pure function
 * over the exact same `ac`/`roles` statements from accessControl.ts (verified by reading
 * better-auth's own createAccessControl/role() source directly — it does no I/O at all).
 * So accessControl.ts didn't need to change for the DynamoDB stack; only this HTTP-request
 * wrapper did, since there's no auth.api to call anymore.
 */
export function requirePermission(role: OrgRole | null, permission: PermissionMap): NextResponse | null {
  if (role === null) return null;

  const result = roles[role].authorize(permission);
  if (!result.success) {
    return NextResponse.json({ error: "You don't have permission to do that." }, { status: 403 });
  }
  return null;
}
