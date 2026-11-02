import { NextRequest, NextResponse } from "next/server";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { withoutOrderSecrets, orderDeliveryDetails } from "@/lib/commerce/bankTransfer";
import { orderDeleteBlocker } from "@/lib/commerce/orderDeletion";
import { paginate, parsePageRequest } from "@/lib/pagination";
import { CommerceOrder, CommerceOrderItem, CommerceBooking, CommerceDigitalDelivery, CommerceProduct } from "@/lib/db/commerceEntities";


export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const fulfillmentStatus = searchParams.get("fulfillmentStatus");
  const paymentMethod = searchParams.get("paymentMethod");
  const q = searchParams.get("q")?.trim().toLowerCase();
  const pageRequest = parsePageRequest(searchParams);

  const { data: allOrders } = await CommerceOrder.query.primary({ templateId }).go({ pages: "all" });
  // Bank transfers waiting to be confirmed, across every order (not just this page) — the Orders banner.
  const awaitingTransferCount = allOrders.filter((o) => o.status === "PENDING" && o.paymentMethod === "BANK_TRANSFER").length;
  let filtered = allOrders;
  if (status) filtered = filtered.filter((o) => o.status === status);
  if (fulfillmentStatus) filtered = filtered.filter((o) => o.fulfillmentStatus === fulfillmentStatus);
  if (paymentMethod) filtered = filtered.filter((o) => (o.paymentMethod ?? "ONLINE") === paymentMethod);
  if (q) {
    filtered = filtered.filter(
      (o) =>
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerEmail.toLowerCase().includes(q) ||
        (o.customerName ?? "").toLowerCase().includes(q),
    );
  }
  filtered = [...filtered].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const { items: page_, total, page, pageSize } = paginate(filtered, pageRequest);

  const orders = await Promise.all(
    page_.map(async (order) => {
      const [{ data: items }, { data: booking }, { data: deliveries }] = await Promise.all([
        CommerceOrderItem.query.primary({ templateId, orderId: order.id }).go({ pages: "all" }),
        CommerceBooking.get({ templateId, orderId: order.id }).go(),
        CommerceDigitalDelivery.query.primary({ orderId: order.id }).go({ pages: "all" }),
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
        ...withoutOrderSecrets(order),
        items: items.map((i) => ({ nameSnapshot: i.nameSnapshot, quantity: i.quantity ?? 1, unitPriceMinor: i.unitPriceMinor })),
        booking: booking ? { scheduledStart: booking.scheduledStart, status: booking.status } : null,
        digitalDeliveries: deliveriesWithProduct,
        // The same rows the dashboard's "Delivery info" column shows: delivery/pickup,
        // address, phone, and the site's own checkout-question answers.
        deliveryDetails: orderDeliveryDetails(order),
        // Why this order can't be deleted, or null if it can — the Orders screen's single source.
        deleteBlocker: orderDeleteBlocker(order),
      };
    }),
  );

  return NextResponse.json({ orders, total, page, pageSize, awaitingTransferCount });
}
