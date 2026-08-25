import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const discounts = await prisma.commerceDiscountCode.findMany({ where: { templateId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ discounts });
}

export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, role } = resolved.context;

  const permissionError = await requirePermission(request.headers, role, { commerce: ["create"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const { code, type, value, expiresAt, usageLimit } = body;

  const normalizedCode = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (!normalizedCode) {
    return NextResponse.json({ error: "A code is required." }, { status: 400 });
  }
  if (type !== "PERCENT" && type !== "FIXED") {
    return NextResponse.json({ error: "type must be PERCENT or FIXED." }, { status: 400 });
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return NextResponse.json({ error: "value must be a positive integer." }, { status: 400 });
  }
  if (type === "PERCENT" && value > 100) {
    return NextResponse.json({ error: "A percentage discount can't exceed 100." }, { status: 400 });
  }

  const existing = await prisma.commerceDiscountCode.findUnique({ where: { templateId_code: { templateId, code: normalizedCode } } });
  if (existing) {
    return NextResponse.json({ error: `"${normalizedCode}" is already in use.` }, { status: 409 });
  }

  const discount = await prisma.commerceDiscountCode.create({
    data: {
      templateId,
      organizationId,
      code: normalizedCode,
      type,
      value,
      expiresAt: typeof expiresAt === "string" && expiresAt ? new Date(expiresAt) : null,
      usageLimit: typeof usageLimit === "number" && usageLimit > 0 ? Math.trunc(usageLimit) : null,
    },
  });

  return NextResponse.json({ discount }, { status: 201 });
}
