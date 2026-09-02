import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { CommerceDiscountCode } from "@/lib/db/commerceEntities";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; id: string }> },
): Promise<NextResponse> {
  const { templateId, id } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = requirePermission(role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const { data: existing } = await CommerceDiscountCode.get({ templateId, id }).go();
  if (!existing) return NextResponse.json({ error: "Discount code not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { active, expiresAt, usageLimit } = body;

  const data: Record<string, unknown> = {};
  const toRemove: string[] = [];
  if (typeof active === "boolean") data.active = active;
  if (expiresAt !== undefined) {
    if (expiresAt) data.expiresAt = new Date(expiresAt).toISOString();
    else toRemove.push("expiresAt");
  }
  if (usageLimit !== undefined) {
    if (typeof usageLimit === "number" && usageLimit > 0) data.usageLimit = Math.trunc(usageLimit);
    else toRemove.push("usageLimit");
  }

  let patch = CommerceDiscountCode.patch({ templateId, id }).set(data);
  if (toRemove.length) patch = patch.remove(toRemove as any);
  await patch.go();
  const { data: discount } = await CommerceDiscountCode.get({ templateId, id }).go();

  return NextResponse.json({ discount });
}

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

  const { data: existing } = await CommerceDiscountCode.get({ templateId, id }).go();
  if (!existing) return NextResponse.json({ error: "Discount code not found." }, { status: 404 });

  await CommerceDiscountCode.remove({ templateId, id }).go();
  return NextResponse.json({ deleted: true });
}
