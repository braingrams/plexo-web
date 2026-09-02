import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

import { handleOrderPaid } from "@/lib/db/commerceWebhookOperations";
import { creditCommerceWallet } from "@/lib/commerce/walletDynamo";
import { CommerceOrder, CommerceBooking, CommerceSettings, StripeCommerceEvent } from "@/lib/db/commerceEntities";

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

/**
 * Webhook for orders paid through Plexo's OWN platform-hosted Commerce Stripe account (see
 * lib/commerce/stripeClient.ts) — deliberately separate from app/api/webhooks/stripe/route.ts,
 * which handles Plexo's own SaaS-billing Stripe account. Different account, different
 * webhook secret, different event-idempotency table (StripeCommerceEvent vs StripeEvent).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.PLATFORM_COMMERCE_STRIPE_WEBHOOK_SECRET;
  const secretKey = process.env.PLATFORM_COMMERCE_STRIPE_SECRET_KEY;
  if (!webhookSecret || !secretKey) {
    return NextResponse.json({ error: "Not configured." }, { status: 404 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const rawBody = await request.text();
  const stripe = new Stripe(secretKey, { apiVersion: "2026-06-24.dahlia" });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    await StripeCommerceEvent.create({ id: event.id }).go();
  } catch (err) {
    if (isConditionalCheckFailure(err)) return NextResponse.json({ received: true }); // already processed
    throw err;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    // CommerceOrder has no stripeCheckoutSessionId-indexed access pattern (only
    // byPaymentRef/byOrderNumber — see commerceEntities.ts): PLATFORM_STRIPE is a
    // staff-approval-gated, low-volume feature, so a bounded Scan (same reasoning as
    // scan-domains/expire-stale-holds) is the honest v1 answer here rather than a third
    // GSI on the busiest entity in the table for what's currently a rare payment path.
    type OrderRow = { id: string; templateId: string; stripeCheckoutSessionId?: string; paymentProvider?: string; status?: string };
    let orderRef: OrderRow | undefined;
    let cursor: string | null = null;
    for (;;) {
      const page: { data: OrderRow[]; cursor: string | null } = await CommerceOrder.scan.go({ cursor });
      orderRef = page.data.find((o) => o.stripeCheckoutSessionId === session.id);
      if (orderRef) break;
      cursor = page.cursor;
      if (!cursor) break;
    }

    if (orderRef && orderRef.paymentProvider === "PLATFORM_STRIPE") {
      try {
        await CommerceOrder.patch({ templateId: orderRef.templateId, id: orderRef.id })
          .set({ status: "PAID", stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : undefined })
          .where((attr, op) => op.eq(attr.status, "PENDING"))
          .go();
      } catch (err) {
        if (!isConditionalCheckFailure(err)) throw err;
        return NextResponse.json({ received: true }); // already moved past PENDING
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
          console.error("Commerce: platform Stripe wallet credit failed", err);
        }
      }
    }
  }

  return NextResponse.json({ received: true });
}
