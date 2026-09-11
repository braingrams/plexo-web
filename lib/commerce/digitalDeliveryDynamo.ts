import { resolveSitePublicUrl } from "@/lib/commerce/siteUrlDynamo";
import { resolveMaildripApiKey, sendCommerceEmail } from "@/lib/commerce/maildripNotify";
import { decryptDigitalAccessSecret } from "@/lib/crypto";
import { buildDigitalFileDeliveryEmail, buildDigitalExternalLinkEmail, buildDigitalAccessGrantedEmail } from "@/lib/mail/templates";
import { CommerceDigitalDelivery, CommerceOrder, CommerceProduct, CommerceSettings } from "@/lib/db/commerceEntities";
import { Template } from "@/lib/db/contentEntities";

/**
 * Re-sends an already-created CommerceDigitalDelivery's email using its EXISTING token —
 * never regenerates it, so any link the buyer already has (or lost) keeps working. Shared
 * by the REST resend route and the resend_digital_delivery MCP tool, so both stay in sync
 * instead of duplicating this email-building logic.
 *
 * DynamoDB-stack port of lib/commerce/digitalDelivery.ts's resendDigitalDelivery
 * (deliverDigitalProducts itself was already ported into
 * lib/db/commerceWebhookOperations.ts as part of the Paystack-webhook foundation).
 */
export async function resendDigitalDelivery(templateId: string, orderId: string, deliveryId: string) {
  // CommerceDigitalDelivery's real primary key is (orderId, productId) — id is just an
  // extra attribute, not part of the key (see commerceEntities.ts) — so a lookup by id
  // fans out over this one order's deliveries, bounded by its own line-item count.
  const { data: deliveries } = await CommerceDigitalDelivery.query.primary({ orderId }).go();
  const delivery = deliveries.find((d) => d.id === deliveryId && d.templateId === templateId);
  if (!delivery) throw new Error("Delivery not found.");

  const [{ data: order }, { data: product }, { data: settings }, { data: template }] = await Promise.all([
    CommerceOrder.get({ templateId, id: orderId }).go(),
    CommerceProduct.get({ templateId, id: delivery.productId }).go(),
    CommerceSettings.get({ templateId }).go(),
    Template.get({ id: templateId }).go(),
  ]);
  if (!order) throw new Error("Delivery not found.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiKey = settings ? resolveMaildripApiKey(settings as any) : null; // same cross-type-system cast as lib/db/commerceWebhookOperations.ts
  if (!apiKey) throw new Error("No MailDrip key configured for this site.");

  const siteName = template?.name ?? "your order";
  const siteUrl = await resolveSitePublicUrl(templateId);
  const accessUrl = `${siteUrl}/api/public/commerce/digital/${delivery.token}`;
  const productName = product?.name ?? "your item";

  let subject: string;
  let html: string;
  if (delivery.method === "FILE_DOWNLOAD") {
    subject = `Your download: ${productName}`;
    html = buildDigitalFileDeliveryEmail({
      siteName,
      productName,
      downloadUrl: accessUrl,
      expiresAt: delivery.expiresAt ? new Date(delivery.expiresAt).toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" }) : null,
    });
  } else if (delivery.method === "EXTERNAL_LINK") {
    subject = `Your access link: ${productName}`;
    html = buildDigitalExternalLinkEmail({ siteName, productName, accessUrl });
  } else {
    subject = `Your access: ${productName}`;
    html = buildDigitalAccessGrantedEmail({
      siteName,
      productName,
      accessInstructions: delivery.accessInstructions ?? "",
      password: delivery.accessPasswordEncrypted ? decryptDigitalAccessSecret(delivery.accessPasswordEncrypted) : null,
      accessUrl,
    });
  }

  await sendCommerceEmail(apiKey, { to: order.customerEmail, subject, html, context: "commerce_digital_delivery", organizationId: order.organizationId, templateId: order.templateId });

  await CommerceDigitalDelivery.patch({ orderId, productId: delivery.productId })
    .add({ resendCount: 1 })
    .set({ lastResentAt: new Date().toISOString() })
    .go();
  const { data: updated } = await CommerceDigitalDelivery.get({ orderId, productId: delivery.productId }).go();
  return updated;
}
