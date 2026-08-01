import { NextResponse } from "next/server";

import { auth } from "@/server/auth";

type PermissionMap = Record<string, string[]>;

/**
 * The real security boundary for role enforcement (the plexo-sdk `readOnly` prop is UX
 * support only, not this). Returns a ready-to-return 403 NextResponse when the caller's
 * role lacks the given permission, or null when the caller may proceed.
 *
 * API-key-authenticated requests (see resolveUser in app/api/v1/domains/route.ts) aren't
 * tied to a human Member row/role — they've always been allowed to act on their own
 * account's resources, so this only applies to session-based (human, role-bearing)
 * callers. Pass the role resolveUser gave you; a null role short-circuits to "allowed."
 */
export async function requirePermission(
  headers: Headers,
  role: string | null,
  permission: PermissionMap,
): Promise<NextResponse | null> {
  if (role === null) return null;

  const result = await auth.api.hasPermission({ headers, body: { permissions: permission } });
  if (!result?.success) {
    return NextResponse.json({ error: "You don't have permission to do that." }, { status: 403 });
  }
  return null;
}
