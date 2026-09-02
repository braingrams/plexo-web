import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { CommerceDiscountCode } from "@/lib/db/commerceEntities";

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const { data: discounts } = await CommerceDiscountCode.query.primary({ templateId }).go();
  discounts.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return NextResponse.json({ discounts });
}

export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, role } = resolved.context;

  const permissionError = requirePermission(role, { commerce: ["create"] });
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

  const { data: byCode } = await CommerceDiscountCode.query.byCode({ templateId, code: normalizedCode }).go();
  if (byCode[0]) {
    return NextResponse.json({ error: `"${normalizedCode}" is already in use.` }, { status: 409 });
  }

  const id = randomUUID();
  await CommerceDiscountCode.create({
    id,
    templateId,
    organizationId,
    code: normalizedCode,
    type,
    value,
    expiresAt: typeof expiresAt === "string" && expiresAt ? new Date(expiresAt).toISOString() : undefined,
    usageLimit: typeof usageLimit === "number" && usageLimit > 0 ? Math.trunc(usageLimit) : undefined,
  }).go();
  const { data: discount } = await CommerceDiscountCode.get({ templateId, id }).go();

  return NextResponse.json({ discount }, { status: 201 });
}
