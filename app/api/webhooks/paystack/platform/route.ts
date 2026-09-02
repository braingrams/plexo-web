import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

import { handleOrderPaid } from "@/lib/db/commerceWebhookOperations";
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

  let event: { event?: string; data?: { id?: number | string; reference?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const eventId = event.data?.id !== undefined ? String(event.data.id) : null;
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

  if (event.event === "charge.success" && event.data?.reference) {
    const reference = event.data.reference;

    const { data: matches } = await CommerceOrder.query.byPaymentRef({ paystackReference: reference }).go();
    const orderRef = matches[0];
    if (orderRef && orderRef.paymentProvider === "PLATFORM_PAYSTACK") {
      try {
        await CommerceOrder.patch({ templateId: orderRef.templateId, id: orderRef.id })
          .set({ status: "PAID" })
          .where((attr, op) => op.eq(attr.status, "PENDING"))
          .go();
      } catch (err) {
        if (!isConditionalCheckFailure(err)) throw err; // already moved past PENDING — not our event to process
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

  return NextResponse.json({ received: true });
}
