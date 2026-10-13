import type { EntityItem } from "electrodb";
import { adjustStockForOrderItems } from "@/lib/commerce/stock";
import {
  CommerceOrder,
  CommerceOrderItem,
  CommerceBooking,
  CommerceBookingSlotLock,
  CommerceDiscountCode,
} from "@/lib/db/commerceEntities";

type OrderItem = EntityItem<typeof CommerceOrder>;

/** Releases everything an unpaid order was holding — same as the stale-hold sweeper and
 * the gateway-failure rollback: restock, free the booking slot (deleted, never
 * status-flipped — see checkoutDynamo.ts), un-claim the discount use. */
export async function releaseOrderHolds(order: OrderItem): Promise<void> {
  const { data: items } = await CommerceOrderItem.query.primary({ templateId: order.templateId, orderId: order.id }).go({ pages: "all" });
  await adjustStockForOrderItems(order.templateId, items, 1);
  const { data: booking } = await CommerceBooking.get({ templateId: order.templateId, orderId: order.id }).go();
  if (booking && booking.status === "PENDING_PAYMENT") {
    await Promise.all([
      CommerceBooking.remove({ templateId: order.templateId, orderId: order.id }).go(),
      CommerceBookingSlotLock.remove({ productId: booking.productId, scheduledStart: booking.scheduledStart }).go(),
    ]);
  }
  if (order.discountCode) {
    const { data: matches } = await CommerceDiscountCode.query.byCode({ templateId: order.templateId, code: order.discountCode }).go({ pages: "all" });
    if (matches[0]) await CommerceDiscountCode.patch({ templateId: order.templateId, id: matches[0].id }).add({ usedCount: -1 }).go().catch(() => undefined);
  }
}

