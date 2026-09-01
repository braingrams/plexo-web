import { NextRequest, NextResponse } from "next/server";
import { resolveOrgContext } from "@/app/api/org/_context";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { removeMember, updateMemberRole } from "@/server/orgDynamo";
import { roles, type OrgRole } from "@/server/accessControl";

const VALID_ROLES = new Set(Object.keys(roles));

export async function PATCH(request: NextRequest, context: { params: Promise<{ userId: string }> }): Promise<NextResponse> {
  const { userId } = await context.params;
  const ctx = await resolveOrgContext();
  if (ctx.error) return ctx.error;

  const permissionError = requirePermission(ctx.role, { member: ["update"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const role = typeof body.role === "string" ? body.role : "";
  if (!VALID_ROLES.has(role)) {
    return NextResponse.json({ error: "A valid role is required." }, { status: 400 });
  }
  if (userId === ctx.userId && role !== "owner") {
    return NextResponse.json({ error: "You can't change your own role." }, { status: 400 });
  }

  await updateMemberRole(ctx.organizationId, userId, role as OrgRole);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ userId: string }> }): Promise<NextResponse> {
  const { userId } = await context.params;
  const ctx = await resolveOrgContext();
  if (ctx.error) return ctx.error;

  const permissionError = requirePermission(ctx.role, { member: ["delete"] });
  if (permissionError) return permissionError;

  if (userId === ctx.userId) {
    return NextResponse.json({ error: "You can't remove yourself from the organization." }, { status: 400 });
  }

  await removeMember(ctx.organizationId, userId);
  return NextResponse.json({ ok: true });
}
