import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

import { prisma } from "@/server/prisma";
import { handleOrderPaid } from "@/lib/commerce/orderFulfillment";
import { creditCommerceWallet } from "@/lib/commerce/wallet";

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
    await prisma.stripeCommerceEvent.create({ data: { id: event.id } });
  } catch {
    return NextResponse.json({ received: true }); // already processed
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    const updated = await prisma.commerceOrder.updateMany({
      where: { stripeCheckoutSessionId: session.id, paymentProvider: "PLATFORM_STRIPE", status: "PENDING" },
      data: { status: "PAID", stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null },
    });

    if (updated.count > 0) {
      const order = await prisma.commerceOrder.findUnique({ where: { stripeCheckoutSessionId: session.id }, include: { booking: true } });
      if (order) {
        const settings = await prisma.commerceSettings.findUnique({ where: { templateId: order.templateId } });
        if (settings) {
          await handleOrderPaid(order, settings);
        }
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
