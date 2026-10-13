import { CommerceOrder, CommerceOrderItem, CommerceBooking, CommerceDigitalDelivery, CommerceProduct } from "@/lib/db/commerceEntities";
import { orderDeliveryDetails } from "@/lib/commerce/bankTransfer";
import { orderDeleteBlocker } from "@/lib/commerce/orderDeletion";
import { OrdersClient, type OrderSummary } from "./OrdersClient";

export default async function CommerceOrdersPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;

  const { data: allOrders } = await CommerceOrder.query.primary({ templateId }).go({ pages: "all" });
  const orders = [...allOrders].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, 25);

  const initialOrders: OrderSummary[] = await Promise.all(
    orders.map(async (o) => {
      const [{ data: items }, { data: booking }, { data: deliveries }] = await Promise.all([
        CommerceOrderItem.query.primary({ templateId, orderId: o.id }).go({ pages: "all" }),
        CommerceBooking.get({ templateId, orderId: o.id }).go(),
        CommerceDigitalDelivery.query.primary({ orderId: o.id }).go({ pages: "all" }),
      ]);
      const digitalDeliveries = await Promise.all(
        deliveries.map(async (d) => {
          const { data: product } = await CommerceProduct.get({ templateId, id: d.productId }).go();
          return {
            id: d.id,
            method: d.method,
            productName: product?.name ?? "",
            deliveredAt: d.deliveredAt ?? null,
            downloadCount: d.downloadCount ?? 0,
            maxDownloads: d.maxDownloads ?? null,
            resendCount: d.resendCount ?? 0,
          };
        }),
      );

      return {
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status ?? "PENDING",
        fulfillmentStatus: o.fulfillmentStatus ?? "UNFULFILLED",
        amountMinor: o.amountMinor,
        currency: o.currency ?? "NGN",
        customerEmail: o.customerEmail,
        customerName: o.customerName ?? null,
        createdAt: o.createdAt ?? new Date().toISOString(),
        items: items.map((i) => ({ nameSnapshot: i.nameSnapshot, quantity: i.quantity ?? 1, unitPriceMinor: i.unitPriceMinor })),
        booking: booking ? { scheduledStart: booking.scheduledStart, status: booking.status ?? "PENDING_PAYMENT" } : null,
        digitalDeliveries,
        paymentMethod: o.paymentMethod ?? "ONLINE",
        deliveryDetails: orderDeliveryDetails(o),
        refundReason: o.refundReason ?? null,
        refundedAt: o.refundedAt ?? null,
        bankTransferRejectReason: o.bankTransferRejectReason ?? null,
        deleteBlocker: orderDeleteBlocker(o),
      };
    }),
  );

  return <OrdersClient templateId={templateId} initialOrders={initialOrders} initialTotal={initialOrders.length} />;
}
