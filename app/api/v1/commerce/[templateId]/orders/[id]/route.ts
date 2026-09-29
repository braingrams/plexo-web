import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { updateOrderFulfillmentStatus, FULFILLMENT_STATUSES } from "@/lib/commerce/orderStatusActions";
import { CommerceOrder, CommerceOrderItem, CommerceBooking } from "@/lib/db/commerceEntities";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; id: string }> },
): Promise<NextResponse> {
  const { templateId, id } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const { data: order } = await CommerceOrder.get({ templateId, id }).go();
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  const [{ data: items }, { data: booking }] = await Promise.all([
    CommerceOrderItem.query.primary({ templateId, orderId: id }).go(),
    CommerceBooking.get({ templateId, orderId: id }).go(),
  ]);

  return NextResponse.json({ order: { ...order, items, booking: booking ?? null } });
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
  const { organizationId, role } = resolved.context;

  const permissionError = requirePermission(role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const { data: existing } = await CommerceOrder.get({ templateId, id }).go();
  if (!existing) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { fulfillmentStatus } = body;
  if (typeof fulfillmentStatus !== "string" || !FULFILLMENT_STATUSES.has(fulfillmentStatus)) {
    return NextResponse.json({ error: "Invalid fulfillmentStatus." }, { status: 400 });
  }

  const order = await updateOrderFulfillmentStatus(templateId, organizationId, id, fulfillmentStatus);
  return NextResponse.json({ order });
}
