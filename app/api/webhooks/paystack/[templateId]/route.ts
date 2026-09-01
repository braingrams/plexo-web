import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

import { prisma } from "@/server/prisma";
import { decryptPaystackKey } from "@/lib/crypto";
import { listConfiguredPaystackSecretKeys } from "@/lib/commerce/paystack";
import { handleOrderPaid } from "@/lib/commerce/orderFulfillment";

// Idempotency guard for Paystack's at-least-once webhook delivery, same defensive shape
// as claimStripeEvent (app/api/webhooks/stripe/route.ts) — claim the event id via a
// standalone insert BEFORE doing any mutation; a unique-constraint failure means it's
// already been processed.
async function claimPaystackEvent(eventId: string, templateId: string, organizationId: string): Promise<boolean> {
  try {
    await prisma.paystackWebhookEvent.create({ data: { id: eventId, templateId, organizationId } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Paystack signs with the MERCHANT'S OWN secret key (HMAC-SHA512 of the raw body), unlike
 * Stripe's separate webhook secret — so the site has to be identifiable from the URL
 * itself before the signature can even be checked. Each Commerce site registers
 * `.../api/webhooks/paystack/<its-own-templateId>` as ITS OWN webhook URL in its own
 * Paystack dashboard, since Paystack keys (and therefore this webhook) are per-site.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;

  const settings = await prisma.commerceSettings.findUnique({ where: { templateId } });
  const configuredKeys = settings ? listConfiguredPaystackSecretKeys(settings) : [];
  if (!settings || configuredKeys.length === 0) {
    // No Commerce site should ever have this URL registered unless it configured Paystack
    // itself — a 404 here can't cause a legitimate webhook to retry-storm.
    return NextResponse.json({ error: "Not configured." }, { status: 404 });
  }

  const signatureHeader = request.headers.get("x-paystack-signature");
  if (!signatureHeader) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  // Raw body, never .json() — needed for the signature check, same reason
  // app/api/webhooks/stripe/route.ts reads it as text first.
  const rawBody = await request.text();
  const providedBuf = Buffer.from(signatureHeader, "utf8");

  // Tried against BOTH configured keys (test and live), not just whichever mode is
  // currently toggled active — a transaction started before a mode switch, or a merchant
  // with both dashboards pointed at this same URL, still needs its signature to verify.
  // Constant-time comparison per candidate — a naive === here is a well-known timing
  // side-channel for exactly this kind of check.
  const signatureValid = configuredKeys.some(({ secretKeyEncrypted }) => {
    const secretKey = decryptPaystackKey(secretKeyEncrypted);
    const expectedSignature = createHmac("sha512", secretKey).update(rawBody).digest("hex");
    const expectedBuf = Buffer.from(expectedSignature, "utf8");
    return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
  });
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

  if (!(await claimPaystackEvent(eventId, templateId, settings.organizationId))) {
    // Already processed — ack and stop, same idempotency shape as claimStripeEvent.
    return NextResponse.json({ received: true });
  }

  if (event.event === "charge.success" && event.data?.reference) {
    const reference = event.data.reference;

    // Atomic guard: only flips PENDING -> PAID, so a duplicate delivery of an event we
    // somehow claimed twice (or a stale retry after a later refund) can never re-process
    // an order that already moved on.
    const updated = await prisma.commerceOrder.updateMany({
      where: { paystackReference: reference, templateId, status: "PENDING" },
      data: { status: "PAID" },
    });

    if (updated.count > 0) {
      const order = await prisma.commerceOrder.findUnique({
        where: { paystackReference: reference },
        include: { booking: true },
      });

      if (order) {
        await handleOrderPaid(order, settings);
      }
    }
  }

  return NextResponse.json({ received: true });
}
