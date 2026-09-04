import type { EntityItem } from "electrodb";
import { decryptMaildripKey } from "@/lib/crypto";
import { formatMoney } from "@/lib/commerce/formatMoney";
import type { CommerceOrder as CommerceOrderEntity, CommerceSettings as CommerceSettingsEntity } from "@/lib/db/commerceEntities";
import { logEmailDelivery } from "@/lib/mail/logEmail";

type CommerceOrder = EntityItem<typeof CommerceOrderEntity>;
type CommerceSettings = EntityItem<typeof CommerceSettingsEntity>;

const PLATFORM_MAILDRIP_API_URL =
  process.env.MAILDRIP_API_URL ?? "https://api.maildrip.io/api/v1/emails/transaction";
const PLATFORM_MAILDRIP_API_KEY = process.env.MAILDRIP_API_KEY;

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

async function sendReceiptEmail(apiKey: string, order: CommerceOrder): Promise<void> {
  const amount = formatMoney(order.amountMinor, order.currency ?? "NGN");
  const subject = `Order ${order.orderNumber} confirmed`;
  try {
    const response = await fetch(PLATFORM_MAILDRIP_API_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        to: order.customerEmail,
        subject,
        html: `<p>Thanks for your order — <strong>${order.orderNumber}</strong> is confirmed.</p><p>Amount paid: <strong>${amount}</strong></p>`,
      }),
    });
    if (!response.ok) {
      throw new Error(`MailDrip receipt send failed (${response.status}): ${await response.text()}`);
    }
    logEmailDelivery({
      kind: "maildrip", to: order.customerEmail, subject, status: "sent",
      context: "commerce_receipt", organizationId: order.organizationId, templateId: order.templateId,
    });
  } catch (err) {
    logEmailDelivery({
      kind: "maildrip", to: order.customerEmail, subject, status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      context: "commerce_receipt", organizationId: order.organizationId, templateId: order.templateId,
    });
    throw err;
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
 * configured MailDrip group and sends a receipt email. Uses the site's OWN MailDrip
 * account when CommerceSettings.maildripApiKeyEncrypted is set, falling back to Plexo's
 * shared platform key otherwise (see the Commerce plan). Every failure here is caught by
 * the caller — a MailDrip outage must never fail or retry-storm the Paystack webhook, since
 * the payment itself is already real and recorded by the time this runs.
 */
/** Site's own MailDrip key when configured, falling back to Plexo's shared platform key —
 * factored out of notifyMaildripOfPaidOrder so other Commerce senders (digital delivery)
 * can resolve the same key without duplicating the fallback logic. */
export function resolveMaildripApiKey(settings: CommerceSettings): string | null {
  return settings.maildripApiKeyEncrypted ? decryptMaildripKey(settings.maildripApiKeyEncrypted) : (PLATFORM_MAILDRIP_API_KEY ?? null);
}

/** Sends a transactional email through a SPECIFIC MailDrip key (e.g. resolveMaildripApiKey's
 * result) — unlike lib/mail/maildrip.ts's sendMaildripEmail, which always uses Plexo's
 * shared platform key, this lets a Commerce email go out under the site's own connected
 * MailDrip account when it has one. organizationId/templateId are optional and only used
 * for EmailLog attribution — every current caller is a digital-delivery send and has both
 * on hand (via the order), but they aren't required by the MailDrip request itself. */
export async function sendCommerceEmail(
  apiKey: string,
  input: { to: string; subject: string; html: string; organizationId?: string; templateId?: string },
): Promise<void> {
  const { organizationId, templateId, ...body } = input;
  try {
    const response = await fetch(PLATFORM_MAILDRIP_API_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`MailDrip send failed (${response.status}): ${await response.text()}`);
    }
    logEmailDelivery({
      kind: "maildrip", to: input.to, subject: input.subject, status: "sent",
      context: "commerce_digital_delivery", organizationId, templateId,
    });
  } catch (err) {
    logEmailDelivery({
      kind: "maildrip", to: input.to, subject: input.subject, status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      context: "commerce_digital_delivery", organizationId, templateId,
    });
    throw err;
  }
}

export async function notifyMaildripOfPaidOrder(settings: CommerceSettings, order: CommerceOrder): Promise<void> {
  const apiKey = resolveMaildripApiKey(settings);

  if (!apiKey) return; // no key configured anywhere — nothing to do

  const tasks: Promise<void>[] = [sendReceiptEmail(apiKey, order)];
  if (settings.maildripPaidGroupId) {
    tasks.push(tagContactIntoGroup(apiKey, settings.maildripPaidGroupId, order));
  }
  await Promise.all(tasks);
}
