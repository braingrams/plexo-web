import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; id: string }> },
): Promise<NextResponse> {
  const { templateId, id } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = await requirePermission(request.headers, role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const existing = await prisma.commerceDiscountCode.findFirst({ where: { id, templateId } });
  if (!existing) return NextResponse.json({ error: "Discount code not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { active, expiresAt, usageLimit } = body;

  const discount = await prisma.commerceDiscountCode.update({
    where: { id },
    data: {
      active: typeof active === "boolean" ? active : undefined,
      expiresAt: expiresAt === undefined ? undefined : expiresAt ? new Date(expiresAt) : null,
      usageLimit: usageLimit === undefined ? undefined : typeof usageLimit === "number" && usageLimit > 0 ? Math.trunc(usageLimit) : null,
    },
  });

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

  const permissionError = await requirePermission(request.headers, role, { commerce: ["delete"] });
  if (permissionError) return permissionError;

  const existing = await prisma.commerceDiscountCode.findFirst({ where: { id, templateId } });
  if (!existing) return NextResponse.json({ error: "Discount code not found." }, { status: 404 });

  await prisma.commerceDiscountCode.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
