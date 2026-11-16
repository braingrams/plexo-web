import { isExpiredButPayable, verifyOrderOnReturn } from "@/lib/commerce/verifyOnReturn";
import { findTemplateForPaystackEvent, processPaystackDonationEvent } from "@/lib/commerce/donations";
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

import { handleOrderPaid } from "@/lib/db/commerceWebhookOperations";
import { handlePaystackBillingEvent } from "@/lib/billing/paystackBilling";
import { creditCommerceWallet } from "@/lib/commerce/walletDynamo";
import { CommerceOrder, CommerceBooking, CommerceSettings, PlatformPaystackWebhookEvent } from "@/lib/db/commerceEntities";

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

/**
 * Webhook for orders paid through Plexo's OWN Paystack account (CommercePaymentProvider
 * PLATFORM_PAYSTACK) — registered ONCE in Plexo's own Paystack dashboard, unlike the
 * per-site .../paystack/[templateId] webhook (BYO_PAYSTACK sites each register their own
 * URL, since each has its own account/keys). Money for every platform-hosted order across
 * every site lands in this one account, so there's exactly one webhook URL for all of them.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secretKey = process.env.PLATFORM_PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ error: "Not configured." }, { status: 404 });
  }

  const signatureHeader = request.headers.get("x-paystack-signature");
  if (!signatureHeader) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const rawBody = await request.text();
  const providedBuf = Buffer.from(signatureHeader, "utf8");
  const expectedSignature = createHmac("sha512", secretKey).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expectedSignature, "utf8");
  const signatureValid = expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
  if (!signatureValid) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  let event: { event?: string; data?: { id?: number | string; reference?: string; subscription_code?: string; plan?: { plan_code?: string } | null } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Invoice events are per billing period (their own code); subscription events per subscription.
  const invoiceCode = (event.data as { invoice_code?: string } | undefined)?.invoice_code;
  const eventId = invoiceCode
    ? `${event.event}:${invoiceCode}`
    : event.data?.id !== undefined
      ? `${event.event === "charge.success" ? "" : `${event.event}:`}${String(event.data.id)}`
      : event.data?.subscription_code
        ? `${event.event}:${event.data.subscription_code}`
        : null;
  if (!eventId) {
    return NextResponse.json({ received: true });
  }

  // Idempotency: same insert-first shape as the per-site webhook's claimPaystackEvent, but
  // against its own dedicated table — this event isn't scoped to one site, so
  // PaystackWebhookEvent's (templateId, organizationId) shape doesn't fit here.
  try {
    await PlatformPaystackWebhookEvent.create({ id: eventId }).go();
  } catch (err) {
    if (isConditionalCheckFailure(err)) return NextResponse.json({ received: true }); // already processed
    throw err;
  }

  // Plexo's own plan billing and AI top-ups in local currency (lib/billing/paystackBilling.ts).
  // If applying fails, the claim is released so Paystack's retry gets another go.
  try {
    if (await handlePaystackBillingEvent(event as { event?: string; data?: Record<string, unknown> })) {
      return NextResponse.json({ received: true });
    }
  } catch (err) {
    console.error("Paystack plan billing event failed", err);
    await PlatformPaystackWebhookEvent.delete({ id: eventId }).go().catch(() => undefined);
    return NextResponse.json({ error: "Could not process event." }, { status: 500 });
  }

  let handledAsOrder = false;
  if (event.event === "charge.success" && event.data?.reference) {
    const reference = event.data.reference;

    const { data: matches } = await CommerceOrder.query.byPaymentRef({ paystackReference: reference }).go();
    const orderRef = matches[0];
    handledAsOrder = Boolean(orderRef);
    if (orderRef && orderRef.paymentProvider === "PLATFORM_PAYSTACK") {
      try {
        await CommerceOrder.patch({ templateId: orderRef.templateId, id: orderRef.id })
          .set({ status: "PAID" })
          .where((attr, op) => op.eq(attr.status, "PENDING"))
          .go();
      } catch (err) {
        if (!isConditionalCheckFailure(err)) throw err; // already moved past PENDING — not our event to process
        // …unless it was only cancelled because its checkout hold expired: reinstate it.
        const { data: current } = await CommerceOrder.get({ templateId: orderRef.templateId, id: orderRef.id }).go();
        if (current && isExpiredButPayable(current)) await verifyOrderOnReturn(current);
        return NextResponse.json({ received: true });
      }

      const [{ data: order }, { data: booking }, { data: settings }] = await Promise.all([
        CommerceOrder.get({ templateId: orderRef.templateId, id: orderRef.id }).go(),
        CommerceBooking.get({ templateId: orderRef.templateId, orderId: orderRef.id }).go(),
        CommerceSettings.get({ templateId: orderRef.templateId }).go(),
      ]);

      if (order && settings) {
        await handleOrderPaid(order, booking, settings);
        try {
          await creditCommerceWallet(order);
        } catch (err) {
          console.error("Commerce: platform Paystack wallet credit failed", err);
        }
      }
    }
  }

  // Monthly donations on Plexo-managed Paystack: tie the event back to its site by plan/subscription.
  if (!handledAsOrder && event.data) {
    const templateId = await findTemplateForPaystackEvent(event.data);
    if (templateId) {
      const { data: settings } = await CommerceSettings.get({ templateId }).go();
      for (const order of await processPaystackDonationEvent(templateId, event as { event?: string; data?: Record<string, unknown> })) {
        if (!settings || order.paymentProvider !== "PLATFORM_PAYSTACK") continue;
        await handleOrderPaid(order, null, settings);
        try {
          await creditCommerceWallet(order);
        } catch (err) {
          console.error("Commerce: platform Paystack wallet credit failed (donation renewal)", err);
        }
      }
    }
  }

  return NextResponse.json({ received: true });
}
