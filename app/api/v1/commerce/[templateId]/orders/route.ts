import { NextRequest, NextResponse } from "next/server";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { CommerceOrder, CommerceOrderItem, CommerceBooking, CommerceDigitalDelivery, CommerceProduct } from "@/lib/db/commerceEntities";

const PAGE_SIZE = 25;

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const fulfillmentStatus = searchParams.get("fulfillmentStatus");
  const q = searchParams.get("q")?.trim().toLowerCase();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const { data: allOrders } = await CommerceOrder.query.primary({ templateId }).go();
  let filtered = allOrders;
  if (status) filtered = filtered.filter((o) => o.status === status);
  if (fulfillmentStatus) filtered = filtered.filter((o) => o.fulfillmentStatus === fulfillmentStatus);
  if (q) {
    filtered = filtered.filter(
      (o) =>
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerEmail.toLowerCase().includes(q) ||
        (o.customerName ?? "").toLowerCase().includes(q),
    );
  }
  filtered = [...filtered].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const total = filtered.length;
  const page_ = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const orders = await Promise.all(
    page_.map(async (order) => {
      const [{ data: items }, { data: booking }, { data: deliveries }] = await Promise.all([
        CommerceOrderItem.query.primary({ templateId, orderId: order.id }).go(),
        CommerceBooking.get({ templateId, orderId: order.id }).go(),
        CommerceDigitalDelivery.query.primary({ orderId: order.id }).go(),
      ]);

      const deliveriesWithProduct = await Promise.all(
        deliveries.map(async (d) => {
          const { data: product } = await CommerceProduct.get({ templateId, id: d.productId }).go();
          return {
            id: d.id,
            method: d.method,
            deliveredAt: d.deliveredAt ?? null,
            downloadCount: d.downloadCount ?? 0,
            maxDownloads: d.maxDownloads ?? null,
            resendCount: d.resendCount ?? 0,
            product: { name: product?.name ?? "" },
          };
        }),
      );

      return {
        ...order,
        items: items.map((i) => ({ nameSnapshot: i.nameSnapshot, quantity: i.quantity ?? 1, unitPriceMinor: i.unitPriceMinor })),
        booking: booking ? { scheduledStart: booking.scheduledStart, status: booking.status } : null,
        digitalDeliveries: deliveriesWithProduct,
      };
    }),
  );

  return NextResponse.json({ orders, total, page, pageSize: PAGE_SIZE });
}
