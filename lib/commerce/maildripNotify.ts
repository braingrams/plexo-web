import type { EntityItem } from "electrodb";
import type { CommerceOrder as CommerceOrderEntity, CommerceSettings as CommerceSettingsEntity } from "@/lib/db/commerceEntities";
import { resolveMaildripApiKey } from "@/lib/mail/maildrip";
import { sendOrderStatusEmail } from "@/lib/commerce/orderStatusActions";

// resolveMaildripApiKey/sendCommerceEmail live in lib/mail/maildrip.ts (not here) purely so
// lib/commerce/orderStatusActions.ts — which notifyMaildripOfPaidOrder below now calls into
// — can import them without a circular dependency back through this file. Re-exported here
// too, since existing callers (lib/db/commerceWebhookOperations.ts) already import them
// from this module.
export { resolveMaildripApiKey, sendCommerceEmail } from "@/lib/mail/maildrip";

type CommerceOrder = EntityItem<typeof CommerceOrderEntity>;
type CommerceSettings = EntityItem<typeof CommerceSettingsEntity>;

const PLATFORM_MAILDRIP_API_URL =
  process.env.MAILDRIP_API_URL ?? "https://api.maildrip.io/api/v1/emails/transaction";

// Derives "https://api.maildrip.io/api/v1" from the transactional-email URL, so the same
// env var already configured for account-security emails also gives us the contacts base.
function maildripApiBase(): string {
  return PLATFORM_MAILDRIP_API_URL.replace(/\/emails\/transaction\/?$/, "");
}

async function tagContactIntoGroup(apiKey: string, groupId: string, order: CommerceOrder): Promise<void> {
  const [firstName, ...rest] = (order.customerName ?? "").trim().split(/\s+/).filter(Boolean);
  const response = await fetch(`${maildripApiBase()}/contacts?groupId=${encodeURIComponent(groupId)}`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: order.customerEmail,
      firstName: firstName || undefined,
      lastName: rest.length ? rest.join(" ") : undefined,
      phone: order.customerPhone ?? undefined,
    }),
  });
  if (!response.ok) {
    throw new Error(`MailDrip contact-tag failed (${response.status}): ${await response.text()}`);
  }
}

/** Tags a bare email into a MailDrip group — the newsletter signup's own path, distinct
 * from tagContactIntoGroup above which always has a real CommerceOrder (name/phone) to
 * draw from. Throws on failure; the caller (a real-time public endpoint, not a
 * best-effort webhook side-effect) surfaces that to the visitor instead of swallowing it. */
export async function tagNewsletterSubscriber(apiKey: string, groupId: string, email: string): Promise<void> {
  const response = await fetch(`${maildripApiBase()}/contacts?groupId=${encodeURIComponent(groupId)}`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    throw new Error(`MailDrip newsletter signup failed (${response.status}): ${await response.text()}`);
  }
}

/**
 * Best-effort, non-blocking post-payment notification: tags the customer into the site's
 * configured MailDrip group and sends the branded PAID order-status email (see
 * lib/commerce/orderStatusActions.ts — gated there by CommerceSettings.notifyCustomerOnPaid,
 * default true). Uses the site's OWN MailDrip account when
 * CommerceSettings.maildripApiKeyEncrypted is set, falling back to Plexo's shared platform
 * key otherwise. Every failure here is caught by the caller — a MailDrip outage must never
 * fail or retry-storm the Paystack webhook, since the payment itself is already real and
 * recorded by the time this runs.
 */
export async function notifyMaildripOfPaidOrder(settings: CommerceSettings, order: CommerceOrder): Promise<void> {
  const apiKey = resolveMaildripApiKey(settings);

  if (!apiKey) return; // no key configured anywhere — nothing to do

  const tasks: Promise<void>[] = [sendOrderStatusEmail(order.templateId, order.organizationId, order.id, "PAID")];
  if (settings.maildripPaidGroupId) {
    tasks.push(tagContactIntoGroup(apiKey, settings.maildripPaidGroupId, order));
  }
  await Promise.all(tasks);
}
