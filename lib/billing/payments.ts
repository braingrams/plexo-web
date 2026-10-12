import { randomBytes } from "node:crypto";
import type Stripe from "stripe";
import type { EntityItem } from "electrodb";

import { User } from "@/lib/db/coreEntities";
import { Payment, ReceiptSequence, type PAYMENT_KINDS, type PAYMENT_STATUSES } from "@/lib/db/ledgerEntities";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildPaymentReceiptEmail } from "@/lib/mail/templates";

// Plexo's own record of every charge on its platform Stripe account. Stripe reports each
// money movement as a charge (charge.succeeded / .failed / .refunded / .updated in
// app/api/webhooks/stripe/route.ts); this turns one into a Payment row that receipts, the
// owner's payment history and the admin console read — none of them call Stripe.
//
// Idempotent by construction: Payment.id is the charge id, so a webhook retry, an
// out-of-order event or a re-run of scripts/backfill-payments.ts updates the same row.

export type PaymentItem = EntityItem<typeof Payment>;
type PaymentKind = (typeof PAYMENT_KINDS)[number];
type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.startsWith("http") ? process.env.NEXT_PUBLIC_APP_URL : "https://plexo.charisol.io";

const iso = (unix: number) => new Date(unix * 1000).toISOString();

function isConditionalCheckFailure(err: unknown): boolean {
  const e = err as { name?: string; cause?: { name?: string } };
  return e?.name === "ConditionalCheckFailedException" || e?.cause?.name === "ConditionalCheckFailedException";
}

function statusOf(charge: Stripe.Charge): PaymentStatus {
  if (charge.status === "failed") return "FAILED";
  if (charge.status === "pending") return "PENDING";
  if (charge.refunded) return "REFUNDED";
  if (charge.amount_refunded > 0) return "PARTIALLY_REFUNDED";
  return "PAID";
}

/** PAID or refunded — a payment that actually went through and gets a receipt. */
export function isSettled(status: PaymentStatus): boolean {
  return status === "PAID" || status === "REFUNDED" || status === "PARTIALLY_REFUNDED";
}

function cardOf(charge: Stripe.Charge) {
  const card = charge.payment_method_details?.card;
  return card?.last4
    ? { cardBrand: card.brand ?? undefined, cardLast4: card.last4, cardExpMonth: card.exp_month ?? undefined, cardExpYear: card.exp_year ?? undefined }
    : {};
}

const PLAN_NAMES: Record<string, string> = { PRO: "Plexo Pro plan", ULTRA: "Plexo Ultra plan" };
const PACK_NAMES: Record<string, string> = { SMALL: "Small pack", MEDIUM: "Medium pack", LARGE: "Large pack" };

function formatPeriod(start: number, end: number): string {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
  return `${new Date(start * 1000).toLocaleDateString("en-GB", opts)} – ${new Date(end * 1000).toLocaleDateString("en-GB", opts)}`;
}

type Described = {
  userId: string | null;
  kind: PaymentKind;
  description: string;
  detail?: string;
  periodStart?: string;
  periodEnd?: string;
  stripeInvoiceId?: string;
  stripeSubscriptionId?: string;
};

/**
 * What a charge paid for, and whose it is — from the metadata plexo-web stamps on every
 * checkout session, subscription and off-session renewal it creates. Only run when a row is
 * first created; later events (refunds, status changes) just update amounts and status.
 */
async function describeCharge(stripe: Stripe, charge: Stripe.Charge): Promise<Described> {
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  const fallback: Described = { userId: null, kind: "OTHER", description: charge.description || "Plexo payment" };

  if (paymentIntentId) {
    // Subscriptions (the plan, funnel slots): the charge pays an invoice.
    const { data: invoicePayments } = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: paymentIntentId }, limit: 1, expand: ["data.invoice"] });
    const invoice = invoicePayments[0]?.invoice;
    if (invoice && typeof invoice !== "string" && !invoice.deleted) {
      const sub = invoice.parent?.subscription_details;
      const meta = sub?.metadata ?? {};
      const line = invoice.lines.data[0];
      const period = line?.period ? { periodStart: iso(line.period.start), periodEnd: iso(line.period.end), detail: formatPeriod(line.period.start, line.period.end) } : {};
      const subscriptionId = typeof sub?.subscription === "string" ? sub.subscription : sub?.subscription?.id;
      const isSlot = meta.kind === "lms_addon_slot";
      return {
        userId: meta.plexoUserId ?? null,
        kind: isSlot ? "FUNNEL_SLOT" : "SUBSCRIPTION",
        description: isSlot ? "Funnel add-on slot" : (PLAN_NAMES[meta.plan ?? ""] ?? line?.description ?? "Plexo subscription"),
        ...period,
        stripeInvoiceId: invoice.id,
        stripeSubscriptionId: subscriptionId,
      };
    }

    // One-off checkouts (credit top-ups, domain registrations, marketplace templates).
    const { data: sessions } = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
    const meta = sessions[0]?.metadata;
    if (meta?.kind === "topup") {
      const credits = Number(meta.credits ?? 0);
      return {
        userId: meta.plexoUserId ?? null,
        kind: "CREDIT_TOPUP",
        description: "AI credit top-up",
        detail: [PACK_NAMES[meta.pack ?? ""], credits > 0 ? `${credits.toLocaleString("en-US")} credits` : null].filter(Boolean).join(" · ") || undefined,
      };
    }
    if (meta?.kind === "domain_purchase") {
      return { userId: meta.plexoUserId ?? null, kind: "DOMAIN_PURCHASE", description: "Domain registration (1 year)", detail: meta.domain };
    }
    if (meta?.kind === "template_purchase") {
      return { userId: meta.plexoUserId ?? null, kind: "TEMPLATE_PURCHASE", description: "Marketplace template" };
    }
    if (sessions[0]) return { ...fallback, userId: meta?.plexoUserId ?? null };
  }

  // Off-session domain renewals carry their own metadata on the PaymentIntent → charge.
  if (charge.metadata?.kind === "domain_renewal") {
    return { userId: charge.metadata.plexoUserId ?? null, kind: "DOMAIN_RENEWAL", description: "Domain renewal (1 year)", detail: charge.metadata.domain };
  }
  return fallback;
}

/** Every Stripe customer plexo-web creates carries metadata.plexoUserId. */
async function userIdForCustomer(stripe: Stripe, customer: Stripe.Charge["customer"]): Promise<string | null> {
  if (!customer) return null;
  const c = typeof customer === "string" ? await stripe.customers.retrieve(customer) : customer;
  return c.deleted ? null : (c.metadata?.plexoUserId ?? null);
}

async function nextReceiptNumber(): Promise<string> {
  const { data } = await ReceiptSequence.update({ name: "receipt" }).add({ value: 1 }).go({ response: "all_new" });
  return `PLX-${String(data.value ?? 0).padStart(6, "0")}`;
}

/**
 * Creates or updates the Payment row for a charge. Returns the row and whether this call is
 * the one that moved it to PAID (so the caller emails the receipt exactly once), or null when
 * the charge can't be tied to a Plexo account.
 */
export async function recordStripeCharge(
  stripe: Stripe,
  charge: Stripe.Charge,
  options: { updateUserCard?: boolean } = {},
): Promise<{ payment: PaymentItem; becamePaid: boolean } | null> {
  const status = statusOf(charge);
  const card = cardOf(charge);
  const { data: existing } = await Payment.get({ id: charge.id }).go();

  if (!existing) {
    const described = await describeCharge(stripe, charge);
    const userId = described.userId ?? (await userIdForCustomer(stripe, charge.customer));
    if (!userId) {
      console.warn(`[payments] charge ${charge.id} has no Plexo account (no plexoUserId in its metadata or customer) — not recorded`);
      return null;
    }
    const { userId: _ignored, ...rest } = described;
    try {
      const { data: payment } = await Payment.create({
        id: charge.id,
        userId,
        ...rest,
        status,
        amountCents: charge.amount,
        refundedCents: charge.amount_refunded,
        currency: charge.currency,
        failureReason: status === "FAILED" ? (charge.outcome?.seller_message ?? charge.failure_message ?? undefined) : undefined,
        ...card,
        billingName: charge.billing_details?.name ?? undefined,
        billingEmail: charge.billing_details?.email ?? charge.receipt_email ?? undefined,
        receiptNumber: isSettled(status) ? await nextReceiptNumber() : undefined,
        receiptToken: randomBytes(24).toString("hex"),
        stripeCustomerId: typeof charge.customer === "string" ? charge.customer : charge.customer?.id,
        stripePaymentIntentId: typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id,
        paidAt: iso(charge.created),
      }).go();
      if (status === "PAID" && options.updateUserCard !== false) await saveUserCard(userId, card);
      return { payment: payment as PaymentItem, becamePaid: status === "PAID" };
    } catch (err) {
      if (!isConditionalCheckFailure(err)) throw err;
      // Another delivery of the same charge created it a moment ago — fall through to update.
    }
  }

  const current = existing ?? (await Payment.get({ id: charge.id }).go()).data;
  if (!current) return null;
  const becamePaid = status === "PAID" && !isSettled(current.status);
  // The charge can arrive before the checkout/invoice it belongs to is readable — if it was
  // first recorded without a label, work it out now that later events have come in.
  const relabel = current.kind === "OTHER" ? await describeCharge(stripe, charge).catch(() => null) : null;
  const { data: payment } = await Payment.patch({ id: charge.id })
    .set({
      status,
      amountCents: charge.amount,
      refundedCents: charge.amount_refunded,
      ...card,
      ...(relabel && relabel.kind !== "OTHER" ? { kind: relabel.kind, description: relabel.description, detail: relabel.detail, periodStart: relabel.periodStart, periodEnd: relabel.periodEnd, stripeInvoiceId: relabel.stripeInvoiceId, stripeSubscriptionId: relabel.stripeSubscriptionId } : {}),
      ...(status === "FAILED" ? { failureReason: charge.outcome?.seller_message ?? charge.failure_message ?? undefined } : {}),
      ...(isSettled(status) && !current.receiptNumber ? { receiptNumber: await nextReceiptNumber() } : {}),
    })
    .go({ response: "all_new" });
  if (becamePaid && options.updateUserCard !== false) await saveUserCard(current.userId, card);
  return { payment: { ...current, ...payment } as PaymentItem, becamePaid };
}

async function saveUserCard(userId: string, card: ReturnType<typeof cardOf>): Promise<void> {
  if (!card.cardLast4) return;
  await User.patch({ id: userId })
    .set({ billingCardBrand: card.cardBrand, billingCardLast4: card.cardLast4, billingCardExpMonth: card.cardExpMonth, billingCardExpYear: card.cardExpYear })
    .go()
    .catch((err) => console.error(`[payments] couldn't save card for ${userId}`, err));
}

/** Link to the PDF receipt — works without signing in (the token is the key), for emails and the admin console. */
export function receiptUrl(payment: Pick<PaymentItem, "id" | "receiptToken">, view: "download" | "inline" = "download"): string {
  return `${APP_URL}/api/billing/receipts/${encodeURIComponent(payment.id)}?t=${payment.receiptToken}${view === "inline" ? "&view=1" : ""}`;
}

/**
 * Emails the Plexo-branded receipt. `onceOnly` (the webhook's automatic send) claims the
 * row first so two deliveries of the same event never send it twice; a resend from the
 * owner or an admin skips that and always sends.
 */
export async function sendReceiptEmail(payment: PaymentItem, options: { to?: string; onceOnly?: boolean } = {}): Promise<{ sent: boolean; to: string }> {
  if (!isSettled(payment.status) || !payment.receiptNumber) throw new Error("This payment didn't go through, so there's no receipt to send.");
  const { data: user } = await User.get({ id: payment.userId }).go();
  const to = options.to ?? user?.email ?? payment.billingEmail;
  if (!to) throw new Error("There's no email address on this account to send the receipt to.");

  const sentAt = new Date().toISOString();
  if (options.onceOnly) {
    try {
      await Payment.patch({ id: payment.id }).set({ receiptEmailedAt: sentAt }).where((attr, op) => op.notExists(attr.receiptEmailedAt)).go();
    } catch (err) {
      if (isConditionalCheckFailure(err)) return { sent: false, to };
      throw err;
    }
  }

  try {
    await sendMaildripEmail({
      to,
      subject: `Your Plexo receipt ${payment.receiptNumber}`,
      html: buildPaymentReceiptEmail({
        receiptNumber: payment.receiptNumber,
        name: user?.name ?? payment.billingName ?? null,
        description: payment.description,
        detail: payment.detail ?? null,
        amountCents: payment.amountCents,
        refundedCents: payment.refundedCents ?? 0,
        currency: payment.currency,
        paidAt: payment.paidAt,
        card: payment.cardLast4 ? { brand: payment.cardBrand ?? "card", last4: payment.cardLast4 } : null,
        downloadUrl: receiptUrl(payment),
        historyUrl: `${APP_URL}/dashboard/settings/subscription#payments`,
      }),
    });
  } catch (err) {
    // Release the claim so Stripe's retry of this webhook sends it again.
    if (options.onceOnly) await Payment.patch({ id: payment.id }).remove(["receiptEmailedAt"]).go().catch(() => undefined);
    throw err;
  }
  if (!options.onceOnly) await Payment.patch({ id: payment.id }).set({ receiptEmailedAt: sentAt }).go();
  return { sent: true, to };
}

/** A user's payments, newest first. */
export async function listPaymentsForUser(userId: string, limit = 50): Promise<PaymentItem[]> {
  const { data } = await Payment.query.byUser({ userId }).go({ order: "desc", limit });
  return data as PaymentItem[];
}
