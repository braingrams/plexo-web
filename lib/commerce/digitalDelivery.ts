import { randomBytes } from "node:crypto";
import type { CommerceOrder, CommerceSettings } from "@prisma/client";

import { prisma } from "@/server/prisma";
import { decryptDigitalAccessSecret } from "@/lib/crypto";
import { resolveSitePublicUrl } from "@/lib/commerce/siteUrl";
import { resolveMaildripApiKey, sendCommerceEmail } from "@/lib/commerce/maildripNotify";
import { resolveNotificationRecipient } from "@/lib/notificationPreferences";
import {
  buildDigitalFileDeliveryEmail,
  buildDigitalExternalLinkEmail,
  buildDigitalAccessGrantedEmail,
} from "@/lib/mail/templates";

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Runs once an order flips to PAID (see lib/commerce/orderFulfillment.ts::handleOrderPaid).
 * Creates one CommerceDigitalDelivery snapshot per digital line item and emails the buyer.
 * Idempotent via CommerceDigitalDelivery's own @@unique([orderId, productId]) — a webhook
 * retry that races this a second time hits that constraint per-item and just skips it,
 * never re-creating or re-emailing an already-delivered item.
 */
export async function deliverDigitalProducts(order: CommerceOrder, settings: CommerceSettings): Promise<void> {
  const items = await prisma.commerceOrderItem.findMany({
    where: { orderId: order.id, product: { kind: "DIGITAL" } },
    include: { product: true },
  });
  if (items.length === 0) return;

  const siteUrl = await resolveSitePublicUrl(order.templateId);
  const template = await prisma.template.findUnique({ where: { id: order.templateId }, select: { name: true } });
  const siteName = template?.name ?? "your order";

  const apiKey = resolveMaildripApiKey(settings);

  for (const item of items) {
    const product = item.product;
    if (!product.digitalDeliveryMethod) continue; // misconfigured product — nothing to deliver

    let delivery;
    try {
      delivery = await prisma.commerceDigitalDelivery.create({
        data: {
          templateId: order.templateId,
          organizationId: order.organizationId,
          orderId: order.id,
          productId: product.id,
          method: product.digitalDeliveryMethod,
          fileUrl: product.digitalFileUrl,
          fileName: product.digitalFileName,
          externalUrl: product.digitalExternalUrl,
          accessInstructions: product.digitalAccessInstructions,
          accessPasswordEncrypted: product.digitalAccessPasswordEncrypted,
          maxDownloads: product.digitalMaxDownloads,
          expiresAt: product.digitalLinkExpiryDays
            ? new Date(Date.now() + product.digitalLinkExpiryDays * 24 * 60 * 60 * 1000)
            : null,
          token: generateToken(),
        },
      });
    } catch {
      // @@unique([orderId, productId]) violation — already delivered by an earlier webhook
      // attempt for this exact item. Skip, don't re-create or re-email.
      continue;
    }

    const accessUrl = `${siteUrl}/api/public/commerce/digital/${delivery.token}`;

    let subject: string;
    let html: string;
    if (delivery.method === "FILE_DOWNLOAD") {
      subject = `Your download: ${product.name}`;
      html = buildDigitalFileDeliveryEmail({
        siteName,
        productName: product.name,
        downloadUrl: accessUrl,
        expiresAt: delivery.expiresAt ? delivery.expiresAt.toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" }) : null,
      });
    } else if (delivery.method === "EXTERNAL_LINK") {
      subject = `Your access link: ${product.name}`;
      html = buildDigitalExternalLinkEmail({ siteName, productName: product.name, accessUrl });
    } else {
      subject = `Your access: ${product.name}`;
      html = buildDigitalAccessGrantedEmail({
        siteName,
        productName: product.name,
        accessInstructions: delivery.accessInstructions ?? "",
        password: delivery.accessPasswordEncrypted ? decryptDigitalAccessSecret(delivery.accessPasswordEncrypted) : null,
        accessUrl,
      });
    }

    if (apiKey) {
      try {
        await sendCommerceEmail(apiKey, { to: order.customerEmail, subject, html });
        await prisma.commerceDigitalDelivery.update({ where: { id: delivery.id }, data: { deliveredAt: new Date() } });
      } catch (err) {
        // Best-effort, same as every other post-payment notification in this webhook —
        // the payment is already real and recorded; a mail outage here shouldn't retry-storm it.
        console.error("Commerce: digital delivery email failed", err);
      }
    }

    // ACCESS_LIST additionally needs the SELLER to act (add the buyer somewhere Plexo
    // doesn't manage) — a distinct, actionable notice, not just the generic payment email.
    if (delivery.method === "ACCESS_LIST") {
      await notifySellerAccessListAction(order, product.name);
    }
  }
}

/**
 * Re-sends an already-created CommerceDigitalDelivery's email using its EXISTING token —
 * never regenerates it, so any link the buyer already has (or lost) keeps working. Shared by
 * the REST resend route and the resend_digital_delivery MCP tool, so both stay in sync
 * instead of duplicating this email-building logic.
 */
export async function resendDigitalDelivery(templateId: string, orderId: string, deliveryId: string) {
  const delivery = await prisma.commerceDigitalDelivery.findFirst({
    where: { id: deliveryId, orderId, templateId },
    include: { order: true, product: { select: { name: true } } },
  });
  if (!delivery) throw new Error("Delivery not found.");

  const settings = await prisma.commerceSettings.findUnique({ where: { templateId } });
  const apiKey = settings ? resolveMaildripApiKey(settings) : null;
  if (!apiKey) throw new Error("No MailDrip key configured for this site.");

  const template = await prisma.template.findUnique({ where: { id: templateId }, select: { name: true } });
  const siteName = template?.name ?? "your order";
  const siteUrl = await resolveSitePublicUrl(templateId);
  const accessUrl = `${siteUrl}/api/public/commerce/digital/${delivery.token}`;

  let subject: string;
  let html: string;
  if (delivery.method === "FILE_DOWNLOAD") {
    subject = `Your download: ${delivery.product.name}`;
    html = buildDigitalFileDeliveryEmail({
      siteName,
      productName: delivery.product.name,
      downloadUrl: accessUrl,
      expiresAt: delivery.expiresAt ? delivery.expiresAt.toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" }) : null,
    });
  } else if (delivery.method === "EXTERNAL_LINK") {
    subject = `Your access link: ${delivery.product.name}`;
    html = buildDigitalExternalLinkEmail({ siteName, productName: delivery.product.name, accessUrl });
  } else {
    subject = `Your access: ${delivery.product.name}`;
    html = buildDigitalAccessGrantedEmail({
      siteName,
      productName: delivery.product.name,
      accessInstructions: delivery.accessInstructions ?? "",
      password: delivery.accessPasswordEncrypted ? decryptDigitalAccessSecret(delivery.accessPasswordEncrypted) : null,
      accessUrl,
    });
  }

  await sendCommerceEmail(apiKey, { to: delivery.order.customerEmail, subject, html });

  return prisma.commerceDigitalDelivery.update({
    where: { id: delivery.id },
    data: { resendCount: { increment: 1 }, lastResentAt: new Date() },
  });
}

async function notifySellerAccessListAction(order: CommerceOrder, productName: string): Promise<void> {
  const template = await prisma.template.findUnique({
    where: { id: order.templateId },
    select: { name: true, user: { select: { email: true } } },
  });
  if (!template) return;
  const to = await resolveNotificationRecipient(order.organizationId, "payments", template.user?.email);
  if (!to) return;

  const { sendMaildripEmail } = await import("@/lib/mail/maildrip");
  await sendMaildripEmail({
    to,
    subject: `Action needed: grant access for ${productName} — ${order.orderNumber}`,
    html: `<p>Order <strong>${order.orderNumber}</strong> on <strong>${template.name}</strong> just paid for <strong>${productName}</strong>, an access-list product.</p><p>Please add <strong>${order.customerEmail}</strong> to whatever you manage this access through (a course platform, a private group, etc.).</p>`,
  }).catch((err) => console.error("Commerce: access-list seller notify failed", err));
}
