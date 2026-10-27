import type { EntityItem } from "electrodb";
import { decryptPaystackKey } from "@/lib/crypto";
import { refundPaystackTransaction } from "@/lib/paystack";
import { resolvePaystackKeysForMode } from "@/lib/commerce/paystack";
import { resolveMaildripApiKey, sendCommerceEmail } from "@/lib/mail/maildrip";
import { resolveSitePublicUrl } from "@/lib/commerce/siteUrlDynamo";
import { formatMoney } from "@/lib/commerce/formatMoney";
import { getOrgBrandDynamo } from "@/server/orgDynamo";
import { buildOrderStatusEmail, type OrderStatusEvent } from "@/lib/mail/templates";
import { refundStripePayment } from "@/lib/commerce/stripeClient";
import { isDonationOrder, resolveDonationGateway } from "@/lib/commerce/donations";
import { Template } from "@/lib/db/contentEntities";
import { orderDeleteBlocker } from "@/lib/commerce/orderDeletion";
import { releaseOrderHolds } from "@/lib/commerce/orderHolds";
import {
  CommerceBooking,
  CommerceBookingSlotLock,
  CommerceDigitalDelivery,
  CommerceDonationCampaign,
  CommerceOrder,
  CommerceOrderItem,
  CommerceSettings,
} from "@/lib/db/commerceEntities";

export const FULFILLMENT_STATUSES = new Set(["UNFULFILLED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "COMPLETED"]);

type CommerceOrderRecord = EntityItem<typeof CommerceOrder>;

/** Carries an HTTP status alongside the message so REST routes can surface the right code
 * (404/400/502) without re-deriving it from the message text — MCP tool callers just read
 * `.message` like any other thrown Error and ignore `.status`. */
export class OrderActionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OrderActionError";
    this.status = status;
  }
}

/** Which CommerceSettings toggle gates each event's customer email — see that entity's own
 * comment for why CANCELLED has no toggle (no trigger for it exists anywhere yet). */
const NOTIFY_SETTING_KEY: Record<OrderStatusEvent, "notifyCustomerOnPaid" | "notifyCustomerOnProcessing" | "notifyCustomerOnReadyForPickup" | "notifyCustomerOnShipped" | "notifyCustomerOnCompleted" | "notifyCustomerOnRefunded"> = {
  PAID: "notifyCustomerOnPaid",
  PROCESSING: "notifyCustomerOnProcessing",
  READY_FOR_PICKUP: "notifyCustomerOnReadyForPickup",
  SHIPPED: "notifyCustomerOnShipped",
  COMPLETED: "notifyCustomerOnCompleted",
  REFUNDED: "notifyCustomerOnRefunded",
};

/**
 * Sends the branded order-status email to the customer for one event, gated by that
 * event's CommerceSettings toggle (default true — see that entity's own comment). Shared
 * by every place an order's status actually changes (fulfillment PATCH, refund, the
 * PAID webhook) so the same branding/toggle logic applies everywhere regardless of
 * whether the change came from the dashboard, the REST API, or an MCP tool call.
 * Best-effort: a delivery failure is logged (via sendCommerceEmail's own logEmailDelivery
 * call) but never thrown — a real status change that already happened must never be
 * undone or blocked by an email provider hiccup.
 */
export async function sendOrderStatusEmail(
  templateId: string,
  organizationId: string,
  orderId: string,
  event: OrderStatusEvent,
): Promise<void> {
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  if (!settings?.[NOTIFY_SETTING_KEY[event]]) return;

  const apiKey = resolveMaildripApiKey(settings);
  if (!apiKey) return; // no MailDrip key configured anywhere — nothing to send through

  const [{ data: order }, { data: items }, { data: site }, brand] = await Promise.all([
    CommerceOrder.get({ templateId, id: orderId }).go(),
    CommerceOrderItem.query.primary({ templateId, orderId }).go({ pages: "all" }),
    Template.get({ id: templateId }).go(),
    getOrgBrandDynamo(organizationId),
  ]);
  if (!order) return;

  const siteName = site?.name ?? "Your store";
  const storeUrl = await resolveSitePublicUrl(templateId);
  const { subject, html } = buildOrderStatusEmail({
    event,
    siteName,
    orderNumber: order.orderNumber,
    amountFormatted: formatMoney(order.amountMinor, order.currency ?? "NGN"),
    items: items.map((i) => ({ nameSnapshot: i.nameSnapshot, quantity: i.quantity ?? 1, unitPriceMinor: i.unitPriceMinor })),
    currency: order.currency ?? "NGN",
    orderUrl: `${storeUrl}/order-confirmation?order=${encodeURIComponent(order.orderNumber)}&email=${encodeURIComponent(order.customerEmail)}`,
    brand,
  });

  try {
    await sendCommerceEmail(apiKey, { to: order.customerEmail, subject, html, context: "commerce_order_status", organizationId, templateId });
  } catch (err) {
    // sendCommerceEmail already logs the failure via logEmailDelivery — this catch just
    // stops it from bubbling into a caller that just recorded a real, already-final
    // status change (a fulfillment update or a completed refund).
    console.error(`Commerce: order status email failed (${event}, order ${orderId})`, err);
  }
}

/** Shared by the fulfillment PATCH route and the update_commerce_order MCP tool. */
export async function updateOrderFulfillmentStatus(
  templateId: string,
  organizationId: string,
  orderId: string,
  fulfillmentStatus: string,
): Promise<CommerceOrderRecord> {
  if (!FULFILLMENT_STATUSES.has(fulfillmentStatus)) {
    throw new OrderActionError("fulfillmentStatus must be one of UNFULFILLED, PROCESSING, READY_FOR_PICKUP, SHIPPED, COMPLETED.", 400);
  }
  const { data: existing } = await CommerceOrder.get({ templateId, id: orderId }).go();
  if (!existing) throw new OrderActionError("Order not found.", 404);

  await CommerceOrder.patch({ templateId, id: orderId }).set({ fulfillmentStatus: fulfillmentStatus as any }).go();
  const { data: order } = await CommerceOrder.get({ templateId, id: orderId }).go();
  if (!order) throw new Error(`Order ${orderId} vanished immediately after being updated`);

  if (fulfillmentStatus !== "UNFULFILLED") {
    await sendOrderStatusEmail(templateId, organizationId, orderId, fulfillmentStatus as OrderStatusEvent);
  }
  return order;
}

/** Every refund — dashboard, REST or MCP — has to clear the same deliberate bar: a stated
 * reason (kept on the order as an audit trail) and the order number typed back exactly,
 * so a refund can never be issued by a stray click or an AI assistant guessing an id. */
export type RefundRequest = { reason: unknown; confirmOrderNumber: unknown; refundedBy: string };

export const MIN_REFUND_REASON_LENGTH = 5;

/**
 * Shared by the refund REST route and the refund_commerce_order MCP tool. Gateway orders
 * refund through Paystack (Paystack-only today — see this repo's own PLATFORM_STRIPE refund
 * gap), using whichever mode's keys the order was actually paid with, never the site's
 * current active mode. A BANK_TRANSFER order has no gateway to refund through — the owner
 * sends the money back themselves, and this records that it happened.
 */
export async function refundCommerceOrder(
  templateId: string,
  organizationId: string,
  orderId: string,
  request: RefundRequest,
): Promise<CommerceOrderRecord> {
  const { data: order } = await CommerceOrder.get({ templateId, id: orderId }).go();
  if (!order) throw new OrderActionError("Order not found.", 404);
  if (order.status !== "PAID") throw new OrderActionError(`Only a PAID order can be refunded (this one is ${order.status}).`, 400);

  const reason = typeof request.reason === "string" ? request.reason.trim().slice(0, 500) : "";
  if (reason.length < MIN_REFUND_REASON_LENGTH) {
    throw new OrderActionError("Give a short reason for this refund (at least 5 characters) — it's kept on the order for your records.", 400);
  }
  const typed = typeof request.confirmOrderNumber === "string" ? request.confirmOrderNumber.trim().toUpperCase() : "";
  if (typed !== order.orderNumber.toUpperCase()) {
    throw new OrderActionError(`To confirm, type the order number exactly: ${order.orderNumber}.`, 400);
  }

  const isBankTransfer = order.paymentMethod === "BANK_TRANSFER";
  const isOwnStripe = !isBankTransfer && order.paymentProvider === "BYO_STRIPE";
  if (isOwnStripe) {
    // The site's own Stripe account: refund straight through it.
    if (!order.stripePaymentIntentId) {
      throw new OrderActionError("Stripe didn't give this payment a refundable reference — refund it from your Stripe dashboard (Payments), then mark it here.", 400);
    }
    const { data: settings } = await CommerceSettings.get({ templateId }).go();
    const stripe = resolveDonationGateway(settings).stripe;
    if (!stripe) throw new OrderActionError("Your Stripe keys aren't connected any more — reconnect them in Settings → Payments to refund.", 400);
    try {
      await refundStripePayment(stripe.secretKey, order.stripePaymentIntentId);
    } catch (err) {
      throw new OrderActionError(err instanceof Error ? err.message : "Refund failed.", 502);
    }
  } else if (!isBankTransfer) {
    if (!order.paystackMode || !order.paystackReference) {
      throw new OrderActionError("This order wasn't paid via Paystack — refunding it isn't supported yet.", 400);
    }
    const { data: settings } = await CommerceSettings.get({ templateId }).go();
    const orderModeKeys = settings
      ? resolvePaystackKeysForMode(
          {
            paystackTestPublicKey: settings.paystackTestPublicKey ?? null,
            paystackTestSecretKeyEncrypted: settings.paystackTestSecretKeyEncrypted ?? null,
            paystackLivePublicKey: settings.paystackLivePublicKey ?? null,
            paystackLiveSecretKeyEncrypted: settings.paystackLiveSecretKeyEncrypted ?? null,
          },
          order.paystackMode,
        )
      : null;
    if (!orderModeKeys?.secretKeyEncrypted) {
      throw new OrderActionError(`This site has no ${order.paystackMode.toLowerCase()}-mode Paystack key configured to refund through.`, 400);
    }
    try {
      await refundPaystackTransaction({ secretKey: decryptPaystackKey(orderModeKeys.secretKeyEncrypted), reference: order.paystackReference });
    } catch (err) {
      throw new OrderActionError(err instanceof Error ? err.message : "Refund failed.", 502);
    }
  }

  await CommerceOrder.patch({ templateId, id: orderId })
    .set({ status: "REFUNDED", refundReason: reason, refundedAt: new Date().toISOString(), refundedBy: request.refundedBy })
    .go();
  const { data: updated } = await CommerceOrder.get({ templateId, id: orderId }).go();
  if (!updated) throw new Error(`Order ${orderId} vanished immediately after being refunded`);
  // A refunded gift no longer counts toward its campaign's progress.
  const campaignId = isDonationOrder(updated) ? (updated.metadata as { campaignId?: string }).campaignId : undefined;
  if (campaignId) {
    await CommerceDonationCampaign.patch({ templateId, id: campaignId })
      .add({ raisedMinor: -updated.amountMinor, donationCount: -1 })
      .go()
      .catch((err) => console.error("Donations: campaign total adjust on refund failed", err));
  }

  await sendOrderStatusEmail(templateId, organizationId, orderId, "REFUNDED");
  return updated;
}

export type DeleteOrderRequest = { confirmOrderNumber: unknown; deletedBy: string };

/**
 * Permanently deletes an order and everything that hangs off it (line items, booking and its
 * time slot, digital-delivery links), so no orphaned rows or live download links are left
 * behind. There is no undo — which is why every caller (dashboard, REST, MCP) must type the
 * order number back exactly, same bar as a refund. Which orders may go at all is decided in
 * lib/commerce/orderDeletion.ts.
 *
 * Inventory: an order still waiting on a bank transfer is holding stock/a slot/a discount use,
 * so those are handed back first. For any other order, stock is left alone — whether sold
 * goods return to the shelf is the owner's call, same as for a refund.
 * A paid donation is taken back out of its campaign's totals, as a refund does.
 */
export async function deleteCommerceOrder(templateId: string, orderId: string, request: DeleteOrderRequest): Promise<{ orderNumber: string }> {
  const { data: order } = await CommerceOrder.get({ templateId, id: orderId }).go();
  if (!order) throw new OrderActionError("Order not found.", 404);

  const blocker = orderDeleteBlocker(order);
  if (blocker) throw new OrderActionError(blocker, 409);

  const typed = typeof request.confirmOrderNumber === "string" ? request.confirmOrderNumber.trim().toUpperCase() : "";
  if (typed !== order.orderNumber.toUpperCase()) {
    throw new OrderActionError(`To confirm, type the order number exactly: ${order.orderNumber}. Deleting an order can't be undone.`, 400);
  }

  if ((order.status ?? "PENDING") === "PENDING") {
    await releaseOrderHolds(order);
  } else {
    const { data: booking } = await CommerceBooking.get({ templateId, orderId }).go();
    if (booking) {
      await Promise.all([
        CommerceBooking.remove({ templateId, orderId }).go(),
        CommerceBookingSlotLock.remove({ productId: booking.productId, scheduledStart: booking.scheduledStart }).go(),
      ]);
    }
  }

  const campaignId = order.status === "PAID" && isDonationOrder(order) ? (order.metadata as { campaignId?: string }).campaignId : undefined;
  if (campaignId) {
    await CommerceDonationCampaign.patch({ templateId, id: campaignId })
      .add({ raisedMinor: -order.amountMinor, donationCount: -1 })
      .go()
      .catch((err) => console.error("Donations: campaign total adjust on order delete failed", err));
  }

  const [{ data: items }, { data: deliveries }] = await Promise.all([
    CommerceOrderItem.query.primary({ templateId, orderId }).go({ pages: "all" }),
    CommerceDigitalDelivery.query.primary({ orderId }).go({ pages: "all" }),
  ]);
  if (items.length) await CommerceOrderItem.delete(items.map((i) => ({ templateId, orderId, id: i.id }))).go();
  if (deliveries.length) await CommerceDigitalDelivery.delete(deliveries.map((d) => ({ orderId, productId: d.productId }))).go();
  // The order itself goes last: if anything above fails the order is still there to retry from,
  // rather than leaving invisible leftovers behind a vanished order.
  await CommerceOrder.delete({ templateId, id: orderId }).go();

  console.info(`Commerce: order ${order.orderNumber} (${orderId}, site ${templateId}) permanently deleted by ${request.deletedBy}`);
  return { orderNumber: order.orderNumber };
}
