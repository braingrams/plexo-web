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
import { Template, LmsFunnel } from "./contentEntities";
import { activateLmsEnrollmentFromOrder } from "@/lib/lms/enrollment";
import { resolveSitePublicUrl } from "@/lib/commerce/siteUrlDynamo";
import { notifyMaildripOfPaidOrder, resolveMaildripApiKey, sendCommerceEmail } from "@/lib/commerce/maildripNotify";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { decryptDigitalAccessSecret } from "@/lib/crypto";
import { formatMoney } from "@/lib/commerce/formatMoney";
import { logEmailDelivery } from "@/lib/mail/logEmail";
import {
  buildPaymentReceivedEmail,
  buildDigitalFileDeliveryEmail,
  buildDigitalExternalLinkEmail,
  buildDigitalAccessGrantedEmail,
} from "@/lib/mail/templates";

// Ported from app/api/webhooks/paystack/[templateId]/route.ts,
// lib/commerce/orderFulfillment.ts, and lib/commerce/digitalDelivery.ts. Signature
// verification (HMAC-SHA512 against the site's own Paystack keys) is unchanged by this
// migration — it doesn't touch the database — so it isn't reproduced here; only the
// DB-touching logic is ported. Not wired into a live route yet, same reason as
// server/authDynamo.ts: the real webhook route still runs against Postgres today.
//
// Every TODO(Phase 4) from the first draft of this file is now resolved — Template and
// PublishedDomain (this file's remaining two dependencies) exist as of Phase 4.

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
 * guaranteed DynamoDB write; MailDrip notify, the payment-received email, and digital
 * delivery are all best-effort side effects, same as the original (a failure in any one
 * of them must never fail the webhook that already recorded a real payment).
 */
export async function handleOrderPaid(order: OrderItem, booking: BookingItem | null, settings: SettingsItem): Promise<void> {
  if (booking) {
    await CommerceBooking.patch({ templateId: order.templateId, orderId: order.id })
      .set({ status: "CONFIRMED" })
      .remove(["holdExpiresAt"])
      .go();
  }

  try {
    // Fully ported as-is — this helper and its dependencies (sendReceiptEmail,
    // tagContactIntoGroup) never touched Prisma to begin with, just `order`/`settings`
    // objects and outbound MailDrip HTTP calls. The cast bridges two independently
    // generated type systems (Prisma's CommerceSettings/CommerceOrder vs. our ElectroDB
    // item shapes) describing the same real fields — the function only ever reads
    // maildripApiKeyEncrypted/maildripPaidGroupId and customerEmail/Name/Phone/
    // orderNumber/amountMinor, all genuinely present and correctly typed on our side.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await notifyMaildripOfPaidOrder(settings as any, order as any);
  } catch (err) {
    console.error("Commerce: MailDrip notify failed", err);
  }

  notifyPaymentReceived(order).catch((err) => console.error("[mail] payment received notification failed:", err));

  try {
    await deliverDigitalProducts(order, settings);
  } catch (err) {
    console.error("Commerce: digital product delivery failed", err);
  }
}

/** Ported from lib/commerce/orderFulfillment.ts's notifyPaymentReceived — gated by
 * NotificationPreferences.payments, same as the original. */
async function notifyPaymentReceived(order: OrderItem): Promise<void> {
  const { data: template } = await Template.get({ id: order.templateId }).go();
  if (!template || !("id" in template)) return;

  const recipient = await resolveNotificationRecipient(order.organizationId, order.customerEmail);
  if (!recipient) return;

  const base = await resolveSitePublicUrl(order.templateId);
  const html = buildPaymentReceivedEmail({
    siteName: template.name,
    amountFormatted: formatMoney(order.amountMinor, order.currency ?? "NGN"),
    customerEmail: order.customerEmail,
    orderNumber: order.orderNumber,
    orderUrl: `${base}/dashboard/commerce/${order.templateId}/orders`,
  });
  const subject = `Payment received on ${template.name} — ${order.orderNumber}`;
  try {
    await sendMaildripEmail({ to: recipient, subject, html });
    logEmailDelivery({
      kind: "maildrip", to: recipient, subject, status: "sent",
      context: "commerce_payment_received", organizationId: order.organizationId, templateId: order.templateId,
    });
  } catch (err) {
    logEmailDelivery({
      kind: "maildrip", to: recipient, subject, status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      context: "commerce_payment_received", organizationId: order.organizationId, templateId: order.templateId,
    });
    throw err;
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
 * Ported from lib/commerce/digitalDelivery.ts in full, including the email send.
 * Idempotency lives in CommerceDigitalDelivery's own primary key (orderId + productId)
 * rather than a Prisma @@unique constraint — create() throwing
 * ConditionalCheckFailedException on a re-run is the direct equivalent.
 */
async function deliverDigitalProducts(order: OrderItem, settings: SettingsItem): Promise<void> {
  const { data: orderItems } = await CommerceOrderItem.query.primary({ templateId: order.templateId, orderId: order.id }).go();
  if (orderItems.length === 0) return;

  const { data: templateData } = await Template.get({ id: order.templateId }).go();
  const siteName = templateData && "id" in templateData ? templateData.name : "your order";
  const siteUrl = await resolveSitePublicUrl(order.templateId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiKey = resolveMaildripApiKey(settings as any); // same cross-type-system cast as above

  const { data: funnel } = await LmsFunnel.get({ templateId: order.templateId }).go();

  for (const item of orderItems) {
    const { data: product } = await CommerceProduct.get({ templateId: order.templateId, id: item.productId }).go();
    if (!product || !("id" in product)) continue;

    // A paid funnel's signup enrollment is architecturally a digital-product purchase, but
    // gating is via LmsEnrollment.status + the learner's session (lib/lms/learnerAuth.ts),
    // not a one-time download token — skip the generic path entirely for this product. See
    // the Funnel/LMS plan's billing section 4b.
    if (funnel?.signupProductId === product.id) {
      try {
        await activateLmsEnrollmentFromOrder(order);
      } catch (err) {
        console.error("LMS: enrollment activation from order failed", err);
      }
      continue;
    }

    if (product.kind !== "DIGITAL" || !product.digitalDeliveryMethod) continue;

    const token = randomBytes(32).toString("hex");
    try {
      await CommerceDigitalDelivery.create({
        id: crypto.randomUUID(),
        templateId: order.templateId,
        organizationId: order.organizationId,
        orderId: order.id,
        productId: product.id,
        method: product.digitalDeliveryMethod,
        token,
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

    const accessUrl = `${siteUrl}/api/public/commerce/digital/${token}`;
    let subject: string;
    let html: string;
    if (product.digitalDeliveryMethod === "FILE_DOWNLOAD") {
      subject = `Your download: ${product.name}`;
      html = buildDigitalFileDeliveryEmail({
        siteName,
        productName: product.name,
        downloadUrl: accessUrl,
        expiresAt: product.digitalLinkExpiryDays
          ? new Date(Date.now() + product.digitalLinkExpiryDays * 24 * 60 * 60 * 1000).toLocaleDateString("en-NG", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })
          : null,
      });
    } else if (product.digitalDeliveryMethod === "EXTERNAL_LINK") {
      subject = `Your access link: ${product.name}`;
      html = buildDigitalExternalLinkEmail({ siteName, productName: product.name, accessUrl });
    } else {
      subject = `Your access: ${product.name}`;
      html = buildDigitalAccessGrantedEmail({
        siteName,
        productName: product.name,
        accessInstructions: product.digitalAccessInstructions ?? "",
        password: product.digitalAccessPasswordEncrypted ? decryptDigitalAccessSecret(product.digitalAccessPasswordEncrypted) : null,
        accessUrl,
      });
    }

    if (apiKey) {
      try {
        await sendCommerceEmail(apiKey, { to: order.customerEmail, subject, html, organizationId: order.organizationId, templateId: order.templateId });
        await CommerceDigitalDelivery.patch({ orderId: order.id, productId: product.id })
          .set({ deliveredAt: new Date().toISOString() })
          .go();
      } catch (err) {
        console.error("Commerce: digital delivery email failed", err);
      }
    }

    // TODO: ACCESS_LIST additionally needs a distinct seller-facing "go add this buyer
    // somewhere" notice (notifySellerAccessListAction in the original) — not ported here,
    // a genuinely separate notification path from everything else in this file.
  }
}
