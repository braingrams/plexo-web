import { randomBytes, timingSafeEqual } from "node:crypto";
import type { EntityItem } from "electrodb";
import { Template } from "@/lib/db/contentEntities";
import { User, NotificationPreferences } from "@/lib/db/coreEntities";
import {
  CommerceOrder,
  CommerceBooking,
  CommerceSettings,
} from "@/lib/db/commerceEntities";
import { handleOrderPaid } from "@/lib/db/commerceWebhookOperations";
import { resolveMaildripApiKey, sendCommerceEmail, sendMaildripEmail } from "@/lib/mail/maildrip";
import { resolveSiteEmailConfig } from "@/lib/mail/siteEmailSettings";
import { logEmailDelivery } from "@/lib/mail/logEmail";
import { buildBankTransferOwnerEmail, buildBankTransferCustomerEmail, buildBankTransferRejectedEmail } from "@/lib/mail/templates";
import { resolveSitePublicUrl } from "@/lib/commerce/siteUrlDynamo";
import { formatMoney } from "@/lib/commerce/formatMoney";
import { getOrgBrandDynamo } from "@/server/orgDynamo";
import { OrderActionError } from "@/lib/commerce/orderStatusActions";
import { releaseOrderHolds } from "@/lib/commerce/orderHolds";
import type { CheckoutFieldAnswer } from "@/lib/commerce/checkoutFields";

type OrderItem = EntityItem<typeof CommerceOrder>;
type SettingsItem = EntityItem<typeof CommerceSettings>;

/**
 * Direct bank transfer: the customer sends money straight to the store's own bank account
 * (shown at checkout), then places the order. Nothing can verify that automatically, so
 * the order stays PENDING (paymentMethod BANK_TRANSFER) until the OWNER confirms the money
 * arrived — via the one-click link in their email, the Orders dashboard, or MCP. Confirming
 * runs the exact same handleOrderPaid pipeline a gateway webhook does (booking confirmed,
 * customer "order confirmed" email, digital delivery), so a bank-transfer order is
 * indistinguishable from a card one from then on.
 */

/** How long a SERVICE booking's slot is held for an unconfirmed transfer — a bank
 * transfer can take a day or two to land, unlike the 15-minute card-checkout hold. */
export const BANK_TRANSFER_HOLD_MS = 7 * 24 * 60 * 60_000;

export function isBankTransferReady(settings: SettingsItem | null | undefined): boolean {
  return Boolean(
    settings?.bankTransferEnabled &&
      settings.bankTransferBankName?.trim() &&
      settings.bankTransferAccountName?.trim() &&
      settings.bankTransferAccountNumber?.trim(),
  );
}

/** Exactly what a customer sees at checkout — never anything beyond these fields. */
export function publicBankDetails(settings: SettingsItem | null | undefined) {
  if (!isBankTransferReady(settings)) return null;
  return {
    bankName: settings!.bankTransferBankName!.trim(),
    accountName: settings!.bankTransferAccountName!.trim(),
    accountNumber: settings!.bankTransferAccountNumber!.trim(),
    instructions: settings!.bankTransferInstructions?.trim() || null,
  };
}

export function generateBankTransferToken(): string {
  return randomBytes(24).toString("hex");
}

export function isValidBankTransferToken(order: Pick<OrderItem, "bankTransferConfirmToken">, token: string | null | undefined): boolean {
  if (!order.bankTransferConfirmToken || !token) return false;
  const a = Buffer.from(order.bankTransferConfirmToken);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The owner's one-click page (app/commerce/bank-transfer/page.tsx). Lives on the Plexo app
 * origin, not the store's own domain, since it's an owner action, not a storefront page. */
export function bankTransferConfirmUrl(order: Pick<OrderItem, "templateId" | "id" | "bankTransferConfirmToken">): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const params = new URLSearchParams({ site: order.templateId, order: order.id, token: order.bankTransferConfirmToken ?? "" });
  return `${base}/commerce/bank-transfer?${params.toString()}`;
}

/** Where owner-facing store emails go: Commerce's own notification email, then the org's
 * notification override, then whoever owns the site. Deliberately NOT gated by the
 * "payments" notification toggle — this email is an action the owner must take for the
 * order to go ahead, not an FYI. */
async function resolveStoreOwnerEmail(templateId: string, organizationId: string, settings: SettingsItem | null | undefined): Promise<string | null> {
  if (settings?.notificationEmail) return settings.notificationEmail;
  const { data: prefs } = await NotificationPreferences.get({ organizationId }).go();
  if (prefs?.notificationEmail) return prefs.notificationEmail;
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template?.userId) return null;
  const { data: owner } = await User.get({ id: template.userId }).go();
  return owner?.email ?? null;
}

/** The order's delivery + checkout-question rows, shared by the owner email and the
 * dashboard's "Delivery info" column so both always show the same thing. */
export function orderDeliveryDetails(order: Pick<OrderItem, "deliveryMethodNameSnapshot" | "pickupLocationSnapshot" | "shippingAddressLine" | "shippingState" | "shippingCountry" | "customerPhone" | "customFields">): [string, string][] {
  const rows: [string, string][] = [];
  if (order.deliveryMethodNameSnapshot) rows.push(["Delivery", order.deliveryMethodNameSnapshot]);
  if (order.pickupLocationSnapshot) rows.push(["Pickup at", order.pickupLocationSnapshot]);
  const address = [order.shippingAddressLine, order.shippingState, order.shippingCountry].filter(Boolean).join(", ");
  if (address) rows.push(["Address", address]);
  if (order.customerPhone) rows.push(["Phone", order.customerPhone]);
  const answers = Array.isArray(order.customFields) ? (order.customFields as CheckoutFieldAnswer[]) : [];
  for (const a of answers) if (a && typeof a.label === "string" && typeof a.value === "string") rows.push([a.label, a.value]);
  return rows;
}

/** Best-effort, right after a bank-transfer order is placed: tell the owner to check their
 * bank (with the confirm link), and tell the customer where to send the money. Neither
 * failure is surfaced to the customer — their order is already real and visible in the
 * dashboard regardless. */
export async function notifyBankTransferPlaced(order: OrderItem, settings: SettingsItem): Promise<void> {
  const [{ data: site }, emailConfig, storeUrl] = await Promise.all([
    Template.get({ id: order.templateId }).go(),
    resolveSiteEmailConfig(order.templateId, order.organizationId),
    resolveSitePublicUrl(order.templateId),
  ]);
  const brand = emailConfig.brand;
  const siteName = brand?.name || site?.name || "Your store";
  const amountFormatted = formatMoney(order.amountMinor, order.currency ?? "NGN");

  const tasks: Promise<void>[] = [];

  tasks.push(
    (async () => {
      const to = await resolveStoreOwnerEmail(order.templateId, order.organizationId, settings);
      if (!to) return;
      const { subject, html } = buildBankTransferOwnerEmail({
        siteName,
        amountFormatted,
        orderNumber: order.orderNumber,
        customerName: order.customerName ?? null,
        customerEmail: order.customerEmail,
        details: orderDeliveryDetails(order),
        confirmUrl: bankTransferConfirmUrl(order),
        brand,
      });
      try {
        if (emailConfig.apiKey) {
          await sendCommerceEmail(emailConfig.apiKey, { to, subject, html, context: "commerce_bank_transfer", organizationId: order.organizationId, templateId: order.templateId });
        } else {
          await sendMaildripEmail({ to, subject, html });
        }
        logEmailDelivery({ kind: "maildrip", to, subject, status: "sent", context: "commerce_bank_transfer", organizationId: order.organizationId, templateId: order.templateId });
      } catch (err) {
        logEmailDelivery({
          kind: "maildrip", to, subject, status: "failed", errorMessage: err instanceof Error ? err.message : String(err),
          context: "commerce_bank_transfer", organizationId: order.organizationId, templateId: order.templateId,
        });
        throw err;
      }
    })(),
  );

  const bank = publicBankDetails(settings);
  const apiKey = emailConfig.apiKey ?? resolveMaildripApiKey(settings);
  if (bank && apiKey && (settings.notifyCustomerOnPaid ?? true)) {
    const { subject, html } = buildBankTransferCustomerEmail({
      siteName,
      amountFormatted,
      orderNumber: order.orderNumber,
      bankRows: [["Pay via", bank.bankName], ["Account name", bank.accountName], ["Account number", bank.accountNumber]],
      instructions: bank.instructions,
      orderUrl: `${storeUrl}/order-confirmation?order=${encodeURIComponent(order.orderNumber)}&email=${encodeURIComponent(order.customerEmail)}`,
      brand,
    });
    tasks.push(sendCommerceEmail(apiKey, { to: order.customerEmail, subject, html, context: "commerce_bank_transfer", organizationId: order.organizationId, templateId: order.templateId }));
  }

  const results = await Promise.allSettled(tasks);
  for (const r of results) if (r.status === "rejected") console.error(`Commerce: bank transfer notification failed (order ${order.id})`, r.reason);
}

function isConditionalCheckFailure(err: unknown): boolean {
  return (err as { name?: string })?.name === "ConditionalCheckFailedException";
}

/**
 * The owner's decision on an awaiting bank transfer — shared by the email link, the
 * dashboard and MCP so all three behave identically. "confirm" flips PENDING -> PAID and
 * runs the normal paid pipeline; "reject" flips PENDING -> CANCELLED, releases stock/slot/
 * discount, and tells the customer. Both are conditional on the order still being an
 * unresolved PENDING bank transfer, so a double click (or two owners at once) can never
 * double-apply either outcome.
 */
export async function resolveBankTransferOrder(params: {
  templateId: string;
  orderId: string;
  action: "confirm" | "reject";
  resolvedBy: string;
  reason?: string | null;
}): Promise<OrderItem> {
  const { templateId, orderId, action, resolvedBy } = params;
  const reason = params.reason?.trim().slice(0, 500) || null;
  const { data: order } = await CommerceOrder.get({ templateId, id: orderId }).go();
  if (!order) throw new OrderActionError("Order not found.", 404);
  if (order.paymentMethod !== "BANK_TRANSFER") throw new OrderActionError("This order wasn't placed with bank transfer.", 400);
  if ((order.status ?? "PENDING") !== "PENDING") {
    throw new OrderActionError(
      order.status === "PAID" ? "This transfer was already confirmed — the order is marked paid." : `This order is already ${(order.status ?? "PENDING").toLowerCase()}.`,
      409,
    );
  }

  const now = new Date().toISOString();
  try {
    await CommerceOrder.patch({ templateId, id: orderId })
      .set({
        status: action === "confirm" ? "PAID" : "CANCELLED",
        bankTransferResolvedAt: now,
        bankTransferResolvedBy: resolvedBy,
        ...(action === "reject" && reason ? { bankTransferRejectReason: reason } : {}),
      })
      .where((attr, op) => op.eq(attr.status, "PENDING"))
      .go();
  } catch (err) {
    if (isConditionalCheckFailure(err)) throw new OrderActionError("Someone already confirmed or cancelled this order — refresh to see its latest status.", 409);
    throw err;
  }

  const { data: updated } = await CommerceOrder.get({ templateId, id: orderId }).go();
  if (!updated) throw new Error(`Order ${orderId} vanished immediately after being updated`);
  const { data: settings } = await CommerceSettings.get({ templateId }).go();

  if (action === "confirm") {
    const { data: booking } = await CommerceBooking.get({ templateId, orderId }).go();
    if (settings) await handleOrderPaid(updated, booking ?? null, settings, { notifyOwner: false });
    return updated;
  }

  await releaseOrderHolds(updated);
  const [emailConfig, storeUrl] = await Promise.all([
    resolveSiteEmailConfig(templateId, updated.organizationId),
    resolveSitePublicUrl(templateId),
  ]);
  const apiKey = emailConfig.apiKey ?? (settings ? resolveMaildripApiKey(settings) : null);
  if (apiKey) {
    try {
      const { data: site } = await Template.get({ id: templateId }).go();
      const brand = emailConfig.brand;
      const { subject, html } = buildBankTransferRejectedEmail({
        siteName: brand?.name || site?.name || "Your store",
        orderNumber: updated.orderNumber,
        amountFormatted: formatMoney(updated.amountMinor, updated.currency ?? "NGN"),
        reason,
        storeUrl,
        brand,
      });
      await sendCommerceEmail(apiKey, { to: updated.customerEmail, subject, html, context: "commerce_bank_transfer", organizationId: updated.organizationId, templateId });
    } catch (err) {
      console.error(`Commerce: bank transfer rejection email failed (order ${orderId})`, err);
    }
  }
  return updated;
}

/** Strips the one-click confirm secret before an order leaves the server through any API
 * (dashboard REST, MCP) — it only ever needs to exist in the owner's email. */
export function withoutOrderSecrets<T extends { bankTransferConfirmToken?: string }>(order: T): Omit<T, "bankTransferConfirmToken"> {
  const { bankTransferConfirmToken: _secret, ...rest } = order;
  return rest;
}
