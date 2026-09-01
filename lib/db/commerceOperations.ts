import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "./client";
import { CommerceOrder, CommerceOrderItem, CommerceBooking, CommerceBookingSlotLock } from "./commerceEntities";

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
  return (
    anyErr?.name === "TransactionCanceledException" &&
    Boolean(anyErr?.CancellationReasons?.some((r) => r.Code === "ConditionalCheckFailed"))
  );
}

/**
 * Creates an order + order item + booking + slot-lock as one TransactWriteItems call —
 * the checkout/booking write path staying inside a single transaction, per the Phase 3
 * checklist item. The slot-lock's create() carries an implicit attribute_not_exists
 * condition on its key (productId + scheduledStart) — if another request already holds
 * that slot, the WHOLE transaction (order, item, and booking included) fails atomically,
 * not just the lock. That's what replaces Prisma's @@unique([productId, scheduledStart])
 * DB-level constraint.
 *
 * Deliberately minimal: real pricing/discount/payment-provider selection is existing
 * business logic (see lib/commerce/*) not ported here — this demonstrates the
 * transactional shape the real implementation needs to preserve, not the full checkout
 * flow, which is a larger integration task for whenever this table goes live.
 */
export async function createBookingOrder(params: {
  templateId: string;
  organizationId: string;
  productId: string;
  productName: string;
  unitPriceMinor: number;
  scheduledStart: string;
  scheduledEnd: string;
  customerEmail: string;
  orderNumber: string;
}): Promise<{ orderId: string; bookingId: string }> {
  const orderId = crypto.randomUUID();
  const orderItemId = crypto.randomUUID();
  const bookingId = crypto.randomUUID();

  const createOrder = CommerceOrder.create({
    id: orderId,
    templateId: params.templateId,
    organizationId: params.organizationId,
    orderNumber: params.orderNumber,
    customerEmail: params.customerEmail,
    amountMinor: params.unitPriceMinor,
    status: "PENDING",
  }).params();

  const createOrderItem = CommerceOrderItem.create({
    id: orderItemId,
    templateId: params.templateId,
    orderId,
    productId: params.productId,
    nameSnapshot: params.productName,
    unitPriceMinor: params.unitPriceMinor,
    quantity: 1,
  }).params();

  const createBooking = CommerceBooking.create({
    id: bookingId,
    templateId: params.templateId,
    organizationId: params.organizationId,
    orderId,
    productId: params.productId,
    scheduledStart: params.scheduledStart,
    scheduledEnd: params.scheduledEnd,
    status: "PENDING_PAYMENT",
  }).params();

  const createSlotLock = CommerceBookingSlotLock.create({
    productId: params.productId,
    scheduledStart: params.scheduledStart,
    bookingId,
  }).params();

  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { Put: createOrder as any },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { Put: createOrderItem as any },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { Put: createBooking as any },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { Put: createSlotLock as any },
        ],
      }),
    );
    return { orderId, bookingId };
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      throw new Error(`Slot ${params.scheduledStart} for product ${params.productId} is already booked`);
    }
    throw err;
  }
}
