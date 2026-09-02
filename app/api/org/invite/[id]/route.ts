import { NextResponse } from "next/server";
import { resolveOrgContext } from "@/app/api/org/_context";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { cancelInvitation, getInvitation } from "@/server/orgDynamo";

// Cancel — an org admin revoking a still-pending invite. Distinct from "reject" (the
// invited person declining it themselves, see ./reject/route.ts), same distinction
// better-auth's org plugin drew (cancelInvitation vs rejectInvitation).
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const ctx = await resolveOrgContext();
  if (ctx.error) return ctx.error;

  const permissionError = requirePermission(ctx.role, { invitation: ["cancel"] });
  if (permissionError) return permissionError;

  const invitation = await getInvitation(id);
  if (!invitation || invitation.organizationId !== ctx.organizationId) {
    return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
  }

  await cancelInvitation(id);
  return NextResponse.json({ ok: true });
}
