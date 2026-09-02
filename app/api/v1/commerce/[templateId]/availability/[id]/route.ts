import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { CommerceAvailabilityRule, CommerceAvailabilityException } from "@/lib/db/commerceEntities";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; id: string }> },
): Promise<NextResponse> {
  const { templateId, id } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = requirePermission(role, { commerce: ["delete"] });
  if (permissionError) return permissionError;

  const type = request.nextUrl.searchParams.get("type");

  if (type === "rule") {
    const { data: existing } = await CommerceAvailabilityRule.get({ templateId, id }).go();
    if (!existing) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
    await CommerceAvailabilityRule.remove({ templateId, id }).go();
    return NextResponse.json({ deleted: true });
  }

  if (type === "exception") {
    const { data: existing } = await CommerceAvailabilityException.get({ templateId, id }).go();
    if (!existing) return NextResponse.json({ error: "Exception not found." }, { status: 404 });
    await CommerceAvailabilityException.remove({ templateId, id }).go();
    return NextResponse.json({ deleted: true });
  }

  return NextResponse.json({ error: "type must be 'rule' or 'exception'." }, { status: 400 });
}
