import { randomUUID } from "node:crypto";
import { TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { lineName, resolvePurchasable } from "@/lib/commerce/variants";
import { adjustStock, takeStockTransactItem } from "@/lib/commerce/stock";
import { EntityItem } from "electrodb";
import { docClient } from "@/lib/db/client";
import {
  CommerceOrder,
  CommerceOrderItem,
  CommerceProduct,
  CommerceDiscountCode,
  CommerceDeliveryMethod,
  CommerceBooking,
  CommerceBookingSlotLock,
  CommerceCart,
  type CommercePaymentProvider,
} from "@/lib/db/commerceEntities";

type ResolvedDeliveryMethod = EntityItem<typeof CommerceDeliveryMethod>;
type ShippingAddress = { shippingCountry: string | null; shippingState: string | null; shippingAddressLine: string | null };

/** Fields shared by both order-creation paths that don't affect the transaction's guards —
 * just snapshotted onto the order. See commerceEntities.ts's CommerceOrder comments. */
export type OrderExtras = {
  paymentMethod: "ONLINE" | "BANK_TRANSFER";
  bankTransferConfirmToken: string | null;
  pickupLocationSnapshot: string | undefined;
  customFields: Array<{ id: string; label: string; value: string }>;
};

function orderExtraAttributes(extras: OrderExtras) {
  return {
    paymentMethod: extras.paymentMethod,
    bankTransferConfirmToken: extras.bankTransferConfirmToken ?? undefined,
    pickupLocationSnapshot: extras.pickupLocationSnapshot,
    customFields: extras.customFields.length ? extras.customFields : undefined,
  };
}

export class OutOfStockError extends Error {
  constructor(public productName?: string) {
    super();
  }
}
export class SlotTakenError extends Error {}
export class InvalidDiscountError extends Error {}
export class CartAlreadyCheckedOutError extends Error {}

type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

/** A variant was missing, removed or switched off between choosing it and paying — the message is shopper-facing. */
export class VariantUnavailableError extends Error {}

function isTransactionCancelled(err: unknown): err is { name: string; CancellationReasons?: Array<{ Code?: string }> } {
  return (err as { name?: string })?.name === "TransactionCanceledException";
}

/**
 * The atomic core of a Commerce checkout: (optionally) decrements PHYSICAL stock,
 * (optionally) claims a discount code's use, creates the order + its one line item, and
 * — for a SERVICE — clears any stale (expired PENDING_PAYMENT) hold on the exact slot and
 * then claims it, all as one DynamoDB TransactWriteItems call. Mirrors
 * lib/db/commerceOperations.ts's createBookingOrder's transactional shape, extended with
 * the stock/discount guards the real checkout flow needs.
 *
 * Each conditional item's position in TransactItems is tracked in `kinds` (parallel
 * array) so a TransactionCanceledException's CancellationReasons (also positional) can be
 * mapped back to which specific guard failed, instead of one generic error for all of
 * them the way lib/db/commerceOperations.ts's minimal demo version did.
 */
export async function createCommerceOrder(params: {
  templateId: string;
  organizationId: string;
  product: EntityItem<typeof CommerceProduct>;
  /** Which variant, for a product with options (lib/commerce/variants.ts). */
  variantId?: string | null;
  quantity: number;
  orderNumber: string;
  paystackReference: string | null;
  customerEmail: string;
  customerName: string | null;
  customerPhone: string | null;
  deliveryMethod: ResolvedDeliveryMethod | null;
  shippingAddress: ShippingAddress;
  discount: EntityItem<typeof CommerceDiscountCode> | null;
  discountAmountMinor: number;
  amountMinor: number;
  currency: string;
  paymentProvider: CommercePaymentProvider;
  paystackMode: "TEST" | "LIVE" | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  extras: OrderExtras;
  // How long a SERVICE slot stays held while unpaid — 15 minutes for a card checkout,
  // much longer for a bank transfer the owner still has to confirm.
  holdMs?: number;
}): Promise<EntityItem<typeof CommerceOrder>> {
  const { templateId, organizationId, product, variantId, quantity, orderNumber, paystackReference, customerEmail, customerName, customerPhone, deliveryMethod, shippingAddress, discount, discountAmountMinor, amountMinor, currency, paymentProvider, paystackMode, scheduledStart, scheduledEnd, extras, holdMs = 15 * 60_000 } = params;

  const purchase = resolvePurchasable(product, variantId);
  if (!purchase.ok) throw new VariantUnavailableError(purchase.error);
  const orderId = randomUUID();
  const orderItemId = randomUUID();
  const bookingId = randomUUID();

  const items: TransactItem[] = [];
  const kinds: string[] = [];

  const isService = product.kind === "SERVICE" && scheduledStart && scheduledEnd;

  // For a SERVICE, clear any stale (expired) hold physically still occupying this exact
  // slot BEFORE claiming it in the same transaction — isSlotAvailable already excluded
  // stale holds when it decided this slot "looks" free, but the SlotLock item's
  // attribute_not_exists condition doesn't know that; it just sees an existing item.
  if (isService) {
    const { data: existingLock } = await CommerceBookingSlotLock.get({ productId: product.id, scheduledStart: scheduledStart!.toISOString() }).go();
    if (existingLock) {
      const { data: existingBooking } = await CommerceBooking.get({ templateId, orderId: existingLock.bookingId }).go();
      const isStale =
        existingBooking &&
        existingBooking.status === "PENDING_PAYMENT" &&
        existingBooking.holdExpiresAt &&
        new Date(existingBooking.holdExpiresAt).getTime() < Date.now();
      if (!isStale) {
        throw new SlotTakenError();
      }
      items.push({ Delete: CommerceBookingSlotLock.remove({ productId: product.id, scheduledStart: scheduledStart!.toISOString() }).params() as unknown as TransactItem["Delete"] });
      kinds.push("slot");
      items.push({ Delete: CommerceBooking.remove({ templateId, orderId: existingLock.bookingId }).params() as unknown as TransactItem["Delete"] });
      kinds.push("slot");
    }
  }

  const stockStep = product.kind === "PHYSICAL" ? takeStockTransactItem(product, purchase.variant?.id, quantity) : null;
  if (stockStep) {
    items.push(stockStep);
    kinds.push("stock");
  }

  if (discount) {
    items.push({
      Update: CommerceDiscountCode.patch({ templateId, id: discount.id })
        .add({ usedCount: 1 })
        .where(
          (attr, op) =>
            `${op.eq(attr.active, true)} AND (${op.notExists(attr.expiresAt)} OR ${op.gt(attr.expiresAt, new Date().toISOString())}) AND (${op.notExists(attr.usageLimit)} OR ${op.lt(attr.usedCount, attr.usageLimit)})`,
        )
        .params() as unknown as TransactItem["Update"],
    });
    kinds.push("discount");
  }

  items.push({
    Put: CommerceOrder.create({
      id: orderId,
      templateId,
      organizationId,
      orderNumber,
      customerEmail,
      customerName: customerName ?? undefined,
      customerPhone: customerPhone ?? undefined,
      deliveryMethod: deliveryMethod?.type ?? undefined,
      deliveryMethodId: deliveryMethod?.id ?? undefined,
      deliveryMethodNameSnapshot: deliveryMethod?.name ?? undefined,
      deliveryFeeMinor: deliveryMethod?.feeMinor ?? 0,
      shippingCountry: deliveryMethod?.type === "COURIER" ? shippingAddress.shippingCountry ?? undefined : undefined,
      shippingState: deliveryMethod?.type === "COURIER" ? shippingAddress.shippingState ?? undefined : undefined,
      shippingAddressLine: deliveryMethod?.type === "COURIER" ? shippingAddress.shippingAddressLine ?? undefined : undefined,
      discountCode: discount?.code,
      discountAmountMinor,
      amountMinor,
      currency,
      paymentProvider,
      paystackMode: paystackMode ?? undefined,
      paystackReference: paystackReference ?? undefined,
      ...orderExtraAttributes(extras),
    }).params() as unknown as TransactItem["Put"],
  });
  kinds.push("order");

  items.push({
    Put: CommerceOrderItem.create({
      id: orderItemId,
      templateId,
      orderId,
      productId: product.id,
      nameSnapshot: lineName(product.name, purchase.label),
      unitPriceMinor: purchase.unitPriceMinor,
      quantity,
      ...(purchase.variant ? { variantId: purchase.variant.id, variantLabel: purchase.label ?? undefined } : {}),
      ...(purchase.sku ? { sku: purchase.sku } : {}),
    }).params() as unknown as TransactItem["Put"],
  });
  kinds.push("orderItem");

  if (isService) {
    items.push({
      Put: CommerceBooking.create({
        id: bookingId,
        templateId,
        organizationId,
        orderId,
        productId: product.id,
        scheduledStart: scheduledStart!.toISOString(),
        scheduledEnd: scheduledEnd!.toISOString(),
        holdExpiresAt: new Date(Date.now() + holdMs).toISOString(),
      }).params() as unknown as TransactItem["Put"],
    });
    kinds.push("booking");

    items.push({
      Put: CommerceBookingSlotLock.create({
        productId: product.id,
        scheduledStart: scheduledStart!.toISOString(),
        bookingId,
      }).params() as unknown as TransactItem["Put"],
    });
    kinds.push("slotCreate");
  }

  try {
    await docClient.send(new TransactWriteCommand({ TransactItems: items }));
  } catch (err) {
    if (isTransactionCancelled(err) && err.CancellationReasons) {
      const failedIndex = err.CancellationReasons.findIndex((r) => r?.Code === "ConditionalCheckFailed");
      const failedKind = failedIndex >= 0 ? kinds[failedIndex] : null;
      if (failedKind === "stock") throw new OutOfStockError();
      if (failedKind === "discount") throw new InvalidDiscountError();
      if (failedKind === "slot" || failedKind === "slotCreate") throw new SlotTakenError();
    }
    throw err;
  }

  const { data: order } = await CommerceOrder.get({ templateId, id: orderId }).go({ consistent: true });
  if (!order) throw new Error(`CommerceOrder ${orderId} vanished immediately after being created`);
  return order;
}

/**
 * Compensates a checkout whose payment-provider initialize call failed after the order
 * transaction above already committed — restores stock, releases the discount claim, and
 * removes the slot hold (deleted, not status-flipped: the SlotLock's uniqueness has no
 * notion of status, so a row left behind — even for a CANCELLED booking — would
 * permanently squat the slot). The order itself keeps its full history (status FAILED).
 */
export async function failCommerceOrder(
  order: EntityItem<typeof CommerceOrder>,
  product: EntityItem<typeof CommerceProduct>,
  quantity: number,
  discount: EntityItem<typeof CommerceDiscountCode> | null,
  variantId?: string | null,
): Promise<void> {
  await CommerceOrder.patch({ templateId: order.templateId, id: order.id }).set({ status: "FAILED" }).go();

  if (product.kind === "PHYSICAL") await adjustStock(order.templateId, product.id, variantId, quantity);
  if (product.kind === "SERVICE") {
    const { data: booking } = await CommerceBooking.get({ templateId: order.templateId, orderId: order.id }).go();
    if (booking) {
      await Promise.all([
        CommerceBooking.remove({ templateId: order.templateId, orderId: order.id }).go(),
        CommerceBookingSlotLock.remove({ productId: booking.productId, scheduledStart: booking.scheduledStart }).go(),
      ]);
    }
  }
  if (discount) {
    await CommerceDiscountCode.patch({ templateId: order.templateId, id: discount.id }).add({ usedCount: -1 }).go().catch(() => undefined);
  }
}

/**
 * Multi-item variant of createCommerceOrder — one order + N order items (one per cart
 * item), each with its own conditional stock decrement, plus the discount claim and
 * marking the cart CONVERTED, all as one TransactWriteItems call. No booking/slot
 * involved: services never go through the cart (see cartDynamo.ts's own comment on the
 * same restriction).
 */
export async function createCommerceCartOrder(params: {
  templateId: string;
  organizationId: string;
  cartId: string;
  items: Array<{ product: EntityItem<typeof CommerceProduct>; quantity: number; variantId?: string | null }>;
  orderNumber: string;
  paystackReference: string | null;
  customerEmail: string;
  customerName: string | null;
  customerPhone: string | null;
  deliveryMethod: ResolvedDeliveryMethod | null;
  shippingAddress: ShippingAddress;
  discount: EntityItem<typeof CommerceDiscountCode> | null;
  discountAmountMinor: number;
  amountMinor: number;
  currency: string;
  paymentProvider: CommercePaymentProvider;
  paystackMode: "TEST" | "LIVE" | null;
  extras: OrderExtras;
}): Promise<EntityItem<typeof CommerceOrder>> {
  const { templateId, organizationId, cartId, items: cartItems, orderNumber, paystackReference, customerEmail, customerName, customerPhone, deliveryMethod, shippingAddress, discount, discountAmountMinor, amountMinor, currency, paymentProvider, paystackMode, extras } = params;

  const orderId = randomUUID();
  const transactItems: TransactItem[] = [];
  const kinds: (string | { productName: string })[] = [];

  const purchases = cartItems.map(({ product, variantId }) => {
    const purchase = resolvePurchasable(product, variantId);
    if (!purchase.ok) throw new VariantUnavailableError(purchase.error);
    return purchase;
  });
  cartItems.forEach(({ product, quantity }, i) => {
    const stockStep = takeStockTransactItem(product, purchases[i].variant?.id, quantity);
    if (stockStep) {
      transactItems.push(stockStep);
      kinds.push({ productName: lineName(product.name, purchases[i].label) });
    }
  });

  if (discount) {
    transactItems.push({
      Update: CommerceDiscountCode.patch({ templateId, id: discount.id })
        .add({ usedCount: 1 })
        .where(
          (attr, op) =>
            `${op.eq(attr.active, true)} AND (${op.notExists(attr.expiresAt)} OR ${op.gt(attr.expiresAt, new Date().toISOString())}) AND (${op.notExists(attr.usageLimit)} OR ${op.lt(attr.usedCount, attr.usageLimit)})`,
        )
        .params() as unknown as TransactItem["Update"],
    });
    kinds.push("discount");
  }

  transactItems.push({
    Put: CommerceOrder.create({
      id: orderId,
      templateId,
      organizationId,
      orderNumber,
      cartId,
      customerEmail,
      customerName: customerName ?? undefined,
      customerPhone: customerPhone ?? undefined,
      deliveryMethod: deliveryMethod?.type ?? undefined,
      deliveryMethodId: deliveryMethod?.id ?? undefined,
      deliveryMethodNameSnapshot: deliveryMethod?.name ?? undefined,
      deliveryFeeMinor: deliveryMethod?.feeMinor ?? 0,
      shippingCountry: deliveryMethod?.type === "COURIER" ? shippingAddress.shippingCountry ?? undefined : undefined,
      shippingState: deliveryMethod?.type === "COURIER" ? shippingAddress.shippingState ?? undefined : undefined,
      shippingAddressLine: deliveryMethod?.type === "COURIER" ? shippingAddress.shippingAddressLine ?? undefined : undefined,
      discountCode: discount?.code,
      discountAmountMinor,
      amountMinor,
      currency,
      paymentProvider,
      paystackMode: paystackMode ?? undefined,
      paystackReference: paystackReference ?? undefined,
      ...orderExtraAttributes(extras),
    }).params() as unknown as TransactItem["Put"],
  });
  kinds.push("order");

  for (const [index, { product, quantity }] of cartItems.entries()) {
    transactItems.push({
      Put: CommerceOrderItem.create({
        id: randomUUID(),
        templateId,
        orderId,
        productId: product.id,
        nameSnapshot: lineName(product.name, purchases[index].label),
        unitPriceMinor: purchases[index].unitPriceMinor,
        quantity,
        ...(purchases[index].variant ? { variantId: purchases[index].variant!.id, variantLabel: purchases[index].label ?? undefined } : {}),
        ...(purchases[index].sku ? { sku: purchases[index].sku! } : {}),
      }).params() as unknown as TransactItem["Put"],
    });
    kinds.push("orderItem");
  }

  transactItems.push({
    Update: CommerceCart.patch({ templateId, id: cartId })
      .set({ status: "CONVERTED", customerEmail })
      .where((attr, op) => op.eq(attr.status, "OPEN"))
      .params() as unknown as TransactItem["Update"],
  });
  kinds.push("cart");

  try {
    await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
  } catch (err) {
    if (isTransactionCancelled(err) && err.CancellationReasons) {
      const failedIndex = err.CancellationReasons.findIndex((r) => r?.Code === "ConditionalCheckFailed");
      const failedKind = failedIndex >= 0 ? kinds[failedIndex] : null;
      if (failedKind && typeof failedKind === "object") throw new OutOfStockError(failedKind.productName);
      if (failedKind === "discount") throw new InvalidDiscountError();
      if (failedKind === "cart") throw new CartAlreadyCheckedOutError();
    }
    throw err;
  }

  const { data: order } = await CommerceOrder.get({ templateId, id: orderId }).go({ consistent: true });
  if (!order) throw new Error(`CommerceOrder ${orderId} vanished immediately after being created`);
  return order;
}

/** Compensates a cart checkout whose payment-provider initialize call failed after the
 * order transaction above already committed — same reasoning as failCommerceOrder, plus
 * reopening the cart so the visitor doesn't lose their items over a payment-provider hiccup. */
export async function failCommerceCartOrder(
  order: EntityItem<typeof CommerceOrder>,
  items: Array<{ product: EntityItem<typeof CommerceProduct>; quantity: number; variantId?: string | null }>,
  discount: EntityItem<typeof CommerceDiscountCode> | null,
): Promise<void> {
  await CommerceOrder.patch({ templateId: order.templateId, id: order.id }).set({ status: "FAILED" }).remove(["cartId"]).go();

  await Promise.all(items.map(({ product, quantity, variantId }) => adjustStock(order.templateId, product.id, variantId, quantity)));
  if (discount) {
    await CommerceDiscountCode.patch({ templateId: order.templateId, id: discount.id }).add({ usedCount: -1 }).go().catch(() => undefined);
  }
  if (order.cartId) {
    await CommerceCart.patch({ templateId: order.templateId, id: order.cartId }).set({ status: "OPEN" }).go().catch(() => undefined);
  }
}
