import { randomBytes } from "node:crypto";
import { EntityItem } from "electrodb";
import { PaystackWebhookEvent } from "./ledgerEntities";
import {
  CommerceOrder,
  CommerceOrderItem,
  CommerceProduct,
  CommerceBooking,
  CommerceDigitalDelivery,
  CommerceSettings,
} from "./commerceEntities";
import { NotificationPreferences } from "./coreEntities";

// Ported from app/api/webhooks/paystack/[templateId]/route.ts and
// lib/commerce/orderFulfillment.ts / digitalDelivery.ts. Signature verification
// (HMAC-SHA512 against the site's own Paystack keys) is unchanged by this migration — it
// doesn't touch the database — so it isn't reproduced here; only the DB-touching logic
// is ported. Not wired into a live route yet, same reason as server/authDynamo.ts: the
// real webhook route still runs against Postgres today.
//
// Two real dependencies this pulls in that weren't in ANY phase's original scope yet —
// PublishedDomain (for resolveSitePublicUrl's email links) and Template (for the site
// name shown in emails) — are Phase 4 (plexo-content) entities that don't exist as
// DynamoDB code yet. Marked as explicit TODOs below rather than stubbed with fake data.

type OrderItem = EntityItem<typeof CommerceOrder>;
type BookingItem = EntityItem<typeof CommerceBooking>;
type SettingsItem = EntityItem<typeof CommerceSettings>;

function isConditionalCheckFailure(err: unknown): boolean {
  return (err as { name?: string })?.name === "ConditionalCheckFailedException";
}

/** Same idempotency shape as claimStripeEvent/StripeEvent — insert-first, a duplicate
 * webhook delivery hits create()'s implicit attribute_not_exists condition and no-ops. */
export async function claimPaystackEvent(eventId: string, templateId: string, organizationId: string): Promise<boolean> {
  try {
    await PaystackWebhookEvent.create({ id: eventId, templateId, organizationId }).go();
    return true;
  } catch (err) {
    if (isConditionalCheckFailure(err)) return false;
    throw err;
  }
}

/**
 * The payment-critical confirmation step. Atomic PENDING -> PAID transition (the
 * .where() condition is what makes this safe against a duplicate/late-retried webhook —
 * it only ever flips an order exactly once), then fetches the order and its booking (if
 * any) for the caller to pass into handleOrderPaid. Returns null if the order wasn't
 * found or wasn't in PENDING (already processed, or a stale event for an order that
 * moved on some other way) — mirrors the original's `updated.count > 0` guard exactly.
 */
export async function confirmPaystackPayment(
  paystackReference: string,
  templateId: string,
): Promise<{ order: OrderItem; booking: BookingItem | null } | null> {
  const { data: matches } = await CommerceOrder.query.byPaymentRef({ paystackReference }).go();
  const orderRef = matches[0];
  if (!orderRef || orderRef.templateId !== templateId) return null;

  try {
    await CommerceOrder.patch({ templateId, id: orderRef.id })
      .set({ status: "PAID" })
      .where((attr, op) => op.eq(attr.status, "PENDING"))
      .go();
  } catch (err) {
    if (isConditionalCheckFailure(err)) return null; // already moved past PENDING — not our event to process
    throw err;
  }

  const { data: order } = await CommerceOrder.get({ templateId, id: orderRef.id }).go();
  if (!order || !("id" in order)) return null;

  const { data: booking } = await CommerceBooking.get({ templateId, orderId: order.id }).go();

  return { order: order as OrderItem, booking: booking && "orderId" in booking ? (booking as BookingItem) : null };
}

/**
 * Everything that happens once an order flips PAID — booking confirmation is a real,
 * guaranteed DynamoDB write; notification and digital delivery are best-effort side
 * effects, same as the original (a failure in either must never fail the webhook that
 * already recorded a real payment).
 */
export async function handleOrderPaid(order: OrderItem, booking: BookingItem | null, settings: SettingsItem): Promise<void> {
  if (booking) {
    await CommerceBooking.patch({ templateId: order.templateId, orderId: order.id })
      .set({ status: "CONFIRMED" })
      .remove(["holdExpiresAt"])
      .go();
  }

  // TODO(Phase 4): the actual payment-received email needs the site's name (Template
  // entity) and, for its order-management link, the site's public URL (PublishedDomain
  // entity) — neither exists as DynamoDB code yet. resolveNotificationRecipient below is
  // fully ported (NotificationPreferences already exists in plexo-core); only the send
  // itself is deferred, gated correctly on whether it would even fire.
  try {
    const recipient = await resolveNotificationRecipient(order.organizationId, order.customerEmail);
    if (recipient) {
      console.log(`TODO(Phase 4): send payment-received email to ${recipient} for order ${order.orderNumber}`);
    }
  } catch (err) {
    console.error("Commerce: payment-received notification failed", err);
  }

  try {
    await deliverDigitalProducts(order, settings);
  } catch (err) {
    console.error("Commerce: digital product delivery failed", err);
  }
}

/** Ported from lib/notificationPreferences.ts's resolveNotificationRecipient, "payments"
 * type only (the one this webhook needs) — same semantics: a missing preferences row
 * means the field's own schema default applies (payments defaults to true), not "off." */
async function resolveNotificationRecipient(organizationId: string, fallbackEmail: string): Promise<string | null> {
  const { data: prefs } = await NotificationPreferences.get({ organizationId }).go();
  const found = prefs && "organizationId" in prefs;
  const enabled = found ? prefs.payments : true;
  if (!enabled) return null;
  const to = (found ? prefs.notificationEmail : null) || fallbackEmail;
  return to || null;
}

/**
 * Ported from lib/commerce/digitalDelivery.ts. Idempotency now lives in
 * CommerceDigitalDelivery's own primary key (orderId + productId) rather than a Prisma
 * @@unique constraint — create() throwing ConditionalCheckFailedException on a re-run is
 * the direct equivalent, caught and skipped exactly like the original's constraint-catch.
 * The actual delivery record creation is real; the delivery EMAIL send is the one piece
 * deferred (same Phase 4 dependency as the payment-received email above).
 */
async function deliverDigitalProducts(order: OrderItem, settings: SettingsItem): Promise<void> {
  const { data: orderItems } = await CommerceOrderItem.query.primary({ templateId: order.templateId, orderId: order.id }).go();
  if (orderItems.length === 0) return;

  for (const item of orderItems) {
    const { data: product } = await CommerceProduct.get({ templateId: order.templateId, id: item.productId }).go();
    if (!product || !("id" in product) || product.kind !== "DIGITAL" || !product.digitalDeliveryMethod) continue;

    try {
      await CommerceDigitalDelivery.create({
        id: crypto.randomUUID(),
        templateId: order.templateId,
        organizationId: order.organizationId,
        orderId: order.id,
        productId: product.id,
        method: product.digitalDeliveryMethod,
        token: randomBytes(32).toString("hex"),
        fileUrl: product.digitalFileUrl,
        fileName: product.digitalFileName,
        externalUrl: product.digitalExternalUrl,
        accessInstructions: product.digitalAccessInstructions,
        accessPasswordEncrypted: product.digitalAccessPasswordEncrypted,
        maxDownloads: product.digitalMaxDownloads,
        expiresAt: product.digitalLinkExpiryDays
          ? new Date(Date.now() + product.digitalLinkExpiryDays * 24 * 60 * 60 * 1000).toISOString()
          : undefined,
      }).go();
    } catch (err) {
      if (isConditionalCheckFailure(err)) continue; // already delivered — webhook retry, not a new item
      throw err;
    }

    console.log(`TODO(Phase 4): email digital delivery for order ${order.id} product ${product.id}`);
  }

  void settings; // resolveMaildripApiKey(settings) needed once the real email send is wired
}
