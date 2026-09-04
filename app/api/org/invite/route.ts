import { NextRequest, NextResponse } from "next/server";
import { resolveOrgContext } from "@/app/api/org/_context";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { createInvitation, listPendingInvitations } from "@/server/orgDynamo";
import { User, Organization } from "@/lib/db/coreEntities";
import { roles, type OrgRole } from "@/server/accessControl";

const VALID_ROLES = new Set(Object.keys(roles));

export async function GET(): Promise<NextResponse> {
  const ctx = await resolveOrgContext();
  if (ctx.error) return ctx.error;

  const invitations = await listPendingInvitations(ctx.organizationId);
  return NextResponse.json({ invitations });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ctx = await resolveOrgContext();
  if (ctx.error) return ctx.error;

  const permissionError = requirePermission(ctx.role, { invitation: ["create"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = typeof body.role === "string" ? body.role : "";
  if (!email || !VALID_ROLES.has(role)) {
    return NextResponse.json({ error: "A valid email and role are required." }, { status: 400 });
  }

  // Granular-permissions v1: scopedTemplateIds is only ever meaningful for role "editor" —
  // owner/admin (and every other role) are never scopable in this pass (see
  // lib/db/coreEntities.ts's Member.scopedTemplateIds doc comment).
  const rawScopedTemplateIds = body.scopedTemplateIds;
  let scopedTemplateIds: string[] | undefined;
  if (rawScopedTemplateIds !== undefined) {
    if (!Array.isArray(rawScopedTemplateIds) || !rawScopedTemplateIds.every((v) => typeof v === "string")) {
      return NextResponse.json({ error: "scopedTemplateIds must be an array of template ids." }, { status: 400 });
    }
    scopedTemplateIds = rawScopedTemplateIds;
  }
  if (scopedTemplateIds && scopedTemplateIds.length > 0 && role !== "editor") {
    return NextResponse.json({ error: "Only the editor role can be scoped to specific pages." }, { status: 400 });
  }

  const [{ data: inviter }, { data: org }] = await Promise.all([
    User.get({ id: ctx.userId }).go(),
    Organization.get({ id: ctx.organizationId }).go(),
  ]);
  if (!inviter || !org) {
    return NextResponse.json({ error: "Could not resolve inviter or organization." }, { status: 500 });
  }

  const invitation = await createInvitation(
    ctx.organizationId,
    org.name,
    email,
    role as OrgRole,
    ctx.userId,
    inviter.name ?? "A teammate",
    scopedTemplateIds,
  );
  return NextResponse.json({ invitation });
}
