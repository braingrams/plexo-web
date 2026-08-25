import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";

const FULFILLMENT_STATUSES = new Set(["UNFULFILLED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "COMPLETED"]);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; id: string }> },
): Promise<NextResponse> {
  const { templateId, id } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const order = await prisma.commerceOrder.findFirst({
    where: { id, templateId },
    include: { items: true, booking: true },
  });
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  return NextResponse.json({ order });
}

// Fulfillment status only — payment status (CommerceOrder.status) is only ever changed by
// the Paystack webhook or the refund route below, never by a plain admin edit here.
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

  const existing = await prisma.commerceOrder.findFirst({ where: { id, templateId } });
  if (!existing) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { fulfillmentStatus } = body;
  if (typeof fulfillmentStatus !== "string" || !FULFILLMENT_STATUSES.has(fulfillmentStatus)) {
    return NextResponse.json({ error: "Invalid fulfillmentStatus." }, { status: 400 });
  }

  const order = await prisma.commerceOrder.update({ where: { id }, data: { fulfillmentStatus: fulfillmentStatus as never } });
  return NextResponse.json({ order });
}
