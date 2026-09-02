import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

import { decryptPaystackKey } from "@/lib/crypto";
import { listConfiguredPaystackSecretKeys } from "@/lib/commerce/paystack";
import { claimPaystackEvent, confirmPaystackPayment, handleOrderPaid } from "@/lib/db/commerceWebhookOperations";
import { CommerceSettings } from "@/lib/db/commerceEntities";

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

  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  const configuredKeys = settings
    ? listConfiguredPaystackSecretKeys({
        paystackMode: settings.paystackMode ?? "TEST",
        paystackTestPublicKey: settings.paystackTestPublicKey ?? null,
        paystackTestSecretKeyEncrypted: settings.paystackTestSecretKeyEncrypted ?? null,
        paystackLivePublicKey: settings.paystackLivePublicKey ?? null,
        paystackLiveSecretKeyEncrypted: settings.paystackLiveSecretKeyEncrypted ?? null,
      })
    : [];
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
    const confirmed = await confirmPaystackPayment(event.data.reference, templateId);
    if (confirmed) {
      await handleOrderPaid(confirmed.order, confirmed.booking, settings);
    }
  }

  return NextResponse.json({ received: true });
}
