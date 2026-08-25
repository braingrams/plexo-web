import { decryptMaildripKey } from "@/lib/crypto";
import type { CommerceOrder, CommerceSettings } from "@prisma/client";

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
  const amount = `₦${(order.amountMinor / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  const response = await fetch(PLATFORM_MAILDRIP_API_URL, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      to: order.customerEmail,
      subject: `Order ${order.orderNumber} confirmed`,
      html: `<p>Thanks for your order — <strong>${order.orderNumber}</strong> is confirmed.</p><p>Amount paid: <strong>${amount}</strong></p>`,
    }),
  });
  if (!response.ok) {
    throw new Error(`MailDrip receipt send failed (${response.status}): ${await response.text()}`);
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
export async function notifyMaildripOfPaidOrder(settings: CommerceSettings, order: CommerceOrder): Promise<void> {
  const apiKey = settings.maildripApiKeyEncrypted
    ? decryptMaildripKey(settings.maildripApiKeyEncrypted)
    : PLATFORM_MAILDRIP_API_KEY;

  if (!apiKey) return; // no key configured anywhere — nothing to do

  const tasks: Promise<void>[] = [sendReceiptEmail(apiKey, order)];
  if (settings.maildripPaidGroupId) {
    tasks.push(tagContactIntoGroup(apiKey, settings.maildripPaidGroupId, order));
  }
  await Promise.all(tasks);
}
