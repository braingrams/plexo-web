import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

import { prisma } from "@/server/prisma";
import { handleOrderPaid } from "@/lib/commerce/orderFulfillment";
import { creditCommerceWallet } from "@/lib/commerce/wallet";

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

  // Idempotency: same defensive shape as the per-site webhook's claimPaystackEvent, but
  // against the shared StripeCommerceEvent-style guard scoped to THIS webhook's own event
  // stream — reuses PaystackWebhookEvent with a synthetic templateId/organizationId isn't
  // right here (this event isn't scoped to one site), so it claims by id alone via a
  // dedicated table.
  try {
    await prisma.platformPaystackWebhookEvent.create({ data: { id: eventId } });
  } catch {
    return NextResponse.json({ received: true });
  }

  if (event.event === "charge.success" && event.data?.reference) {
    const reference = event.data.reference;

    const updated = await prisma.commerceOrder.updateMany({
      where: { paystackReference: reference, paymentProvider: "PLATFORM_PAYSTACK", status: "PENDING" },
      data: { status: "PAID" },
    });

    if (updated.count > 0) {
      const order = await prisma.commerceOrder.findUnique({ where: { paystackReference: reference }, include: { booking: true } });
      if (order) {
        const settings = await prisma.commerceSettings.findUnique({ where: { templateId: order.templateId } });
        if (settings) {
          await handleOrderPaid(order, settings);
        }
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
