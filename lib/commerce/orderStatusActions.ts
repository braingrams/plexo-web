import type { EntityItem } from "electrodb";
import { decryptPaystackKey } from "@/lib/crypto";
import { refundPaystackTransaction } from "@/lib/paystack";
import { resolvePaystackKeysForMode } from "@/lib/commerce/paystack";
import { resolveMaildripApiKey, sendCommerceEmail } from "@/lib/mail/maildrip";
import { resolveSitePublicUrl } from "@/lib/commerce/siteUrlDynamo";
import { formatMoney } from "@/lib/commerce/formatMoney";
import { getOrgBrandDynamo } from "@/server/orgDynamo";
import { buildOrderStatusEmail, type OrderStatusEvent } from "@/lib/mail/templates";
import { Template } from "@/lib/db/contentEntities";
import { CommerceOrder, CommerceOrderItem, CommerceSettings } from "@/lib/db/commerceEntities";

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
    CommerceOrderItem.query.primary({ templateId, orderId }).go(),
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

/**
 * Shared by the refund REST route and the refund_commerce_order MCP tool — Paystack-only
 * today (see this repo's own PLATFORM_STRIPE refund gap), refunding through whichever
 * mode's keys the order was actually paid with, never the site's current active mode.
 */
export async function refundCommerceOrder(
  templateId: string,
  organizationId: string,
  orderId: string,
): Promise<CommerceOrderRecord> {
  const { data: order } = await CommerceOrder.get({ templateId, id: orderId }).go();
  if (!order) throw new OrderActionError("Order not found.", 404);
  if (order.status !== "PAID") throw new OrderActionError(`Only a PAID order can be refunded (this one is ${order.status}).`, 400);
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
  await CommerceOrder.patch({ templateId, id: orderId }).set({ status: "REFUNDED" }).go();
  const { data: updated } = await CommerceOrder.get({ templateId, id: orderId }).go();
  if (!updated) throw new Error(`Order ${orderId} vanished immediately after being refunded`);

  await sendOrderStatusEmail(templateId, organizationId, orderId, "REFUNDED");
  return updated;
}
