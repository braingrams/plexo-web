import type { CommerceBooking, CommerceOrder, CommerceSettings } from "@prisma/client";

import { prisma } from "@/server/prisma";
import { notifyMaildripOfPaidOrder } from "@/lib/commerce/maildripNotify";
import { deliverDigitalProducts } from "@/lib/commerce/digitalDelivery";
import { resolveNotificationRecipient } from "@/lib/notificationPreferences";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildPaymentReceivedEmail } from "@/lib/mail/templates";

/**
 * Everything that happens once an order flips PENDING -> PAID, regardless of which webhook
 * confirmed it (the existing per-site Paystack webhook, or the platform Paystack/Stripe
 * webhooks) — factored out so this logic lives in exactly one place instead of being
 * triplicated across three webhook handlers. Every step here is best-effort: a failure in
 * one (a MailDrip outage, say) must never fail or retry-storm the webhook that called this,
 * since the payment itself is already real and recorded by the time this runs.
 *
 * `order.booking` must be included by the caller's own fetch (CommerceOrder has no
 * booking column of its own — it's the reverse side of CommerceBooking.orderId).
 */
export async function handleOrderPaid(order: CommerceOrder & { booking?: CommerceBooking | null }, settings: CommerceSettings): Promise<void> {
  if (order.booking) {
    await prisma.commerceBooking.update({
      where: { id: order.booking.id },
      data: { status: "CONFIRMED", holdExpiresAt: null },
    });
  }

  try {
    await notifyMaildripOfPaidOrder(settings, order);
  } catch (err) {
    console.error("Commerce: MailDrip notify failed", err);
  }

  void notifyPaymentReceived(order, settings).catch((err) => console.error("[mail] payment received notification failed:", err));

  try {
    await deliverDigitalProducts(order, settings);
  } catch (err) {
    console.error("Commerce: digital product delivery failed", err);
  }
}

/** Gated by NotificationPreferences.payments — CommerceSettings.notificationEmail has
 * existed as a stored field since Commerce shipped but this webhook never actually sent
 * anything to it; this is the real send it was always meant to gate. */
async function notifyPaymentReceived(order: CommerceOrder, settings: CommerceSettings): Promise<void> {
  const template = await prisma.template.findUnique({ where: { id: order.templateId }, select: { name: true, user: { select: { email: true } } } });
  if (!template) return;

  const to = await resolveNotificationRecipient(settings.organizationId, "payments", template.user?.email);
  if (!to) return;

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const html = buildPaymentReceivedEmail({
    siteName: template.name,
    amountFormatted: `₦${(order.amountMinor / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`,
    customerEmail: order.customerEmail,
    orderNumber: order.orderNumber,
    orderUrl: `${base}/dashboard/commerce/${order.templateId}/orders`,
  });
  await sendMaildripEmail({ to, subject: `Payment received on ${template.name} — ${order.orderNumber}`, html });
}
