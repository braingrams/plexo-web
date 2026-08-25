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
  }));

  return <OrdersClient templateId={templateId} initialOrders={initialOrders} initialTotal={initialOrders.length} />;
}
