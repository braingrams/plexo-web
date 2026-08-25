import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";

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

  const type = request.nextUrl.searchParams.get("type");

  if (type === "rule") {
    const existing = await prisma.commerceAvailabilityRule.findFirst({ where: { id, templateId } });
    if (!existing) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
    await prisma.commerceAvailabilityRule.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  }

  if (type === "exception") {
    const existing = await prisma.commerceAvailabilityException.findFirst({ where: { id, templateId } });
    if (!existing) return NextResponse.json({ error: "Exception not found." }, { status: 404 });
    await prisma.commerceAvailabilityException.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  }

  return NextResponse.json({ error: "type must be 'rule' or 'exception'." }, { status: 400 });
}
