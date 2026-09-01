import { prisma } from "@/server/prisma";
import { OrdersClient, type OrderSummary } from "./OrdersClient";

export default async function CommerceOrdersPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;

  const orders = await prisma.commerceOrder.findMany({
    where: { templateId },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: {
      items: { select: { nameSnapshot: true, quantity: true, unitPriceMinor: true } },
      booking: { select: { scheduledStart: true, status: true } },
      digitalDeliveries: {
        select: { id: true, method: true, deliveredAt: true, downloadCount: true, maxDownloads: true, resendCount: true, product: { select: { name: true } } },
      },
    },
  });

  const initialOrders: OrderSummary[] = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    fulfillmentStatus: o.fulfillmentStatus,
    amountMinor: o.amountMinor,
    customerEmail: o.customerEmail,
    customerName: o.customerName,
    createdAt: o.createdAt.toISOString(),
    items: o.items,
    booking: o.booking ? { scheduledStart: o.booking.scheduledStart.toISOString(), status: o.booking.status } : null,
    digitalDeliveries: o.digitalDeliveries.map((d) => ({
      id: d.id,
      method: d.method,
      productName: d.product.name,
      deliveredAt: d.deliveredAt ? d.deliveredAt.toISOString() : null,
      downloadCount: d.downloadCount,
      maxDownloads: d.maxDownloads,
      resendCount: d.resendCount,
    })),
  }));

  return <OrdersClient templateId={templateId} initialOrders={initialOrders} initialTotal={initialOrders.length} />;
}
