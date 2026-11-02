import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { User, UserEmailLock } from "@/lib/db/coreEntities";
import { parseAdminGrant, adminEndpointsEnabled } from "@/lib/admin/adminGrant";

/**
 * POST /api/internal/admins
 * Header: x-admin-token: <INTERNAL_ADMIN_TOKEN>
 * Body:   { "email": "person@example.com", "adminRole": "SUPERADMIN" | "SUPPORT" | "MODERATOR" | "FINANCE" }
 *
 * Gives an existing account a platform admin role by setting User.adminRole. The account must
 * already exist: the email is looked up in its UserEmailLock row, which points to the User.
 *
 * Anyone with the token can make any account an admin, so keep the token secret and rotate it
 * if it leaks. Every grant is logged with the email and role.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Off everywhere except the staging stack. A 404 (not 403) so the route doesn't reveal itself.
  if (!adminEndpointsEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const grant = parseAdminGrant(body);
  if (typeof grant === "string") {
    return NextResponse.json({ error: grant }, { status: 400 });
  }

  const { data: lock } = await UserEmailLock.get({ email: grant.email }).go();
  if (!lock) {
    return NextResponse.json({ error: `No account exists for ${grant.email}.` }, { status: 404 });
  }

  const { data: user } = await User.get({ id: lock.userId }).go();
  if (!user) {
    return NextResponse.json({ error: `The account for ${grant.email} is missing its profile row.` }, { status: 409 });
  }

  await User.patch({ id: user.id }).set({ adminRole: grant.adminRole }).go();
  console.log(`[admin-grant] ${grant.email} (user ${user.id}) granted ${grant.adminRole}`);

  return NextResponse.json({ email: grant.email, userId: user.id, adminRole: grant.adminRole });
}
