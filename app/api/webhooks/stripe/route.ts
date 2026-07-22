import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";

import { grantTopup } from "@/lib/credits/ledger";
import { getStripe } from "@/lib/stripe";
import type { SubscriptionPlan } from "@/lib/subscription";
import { prisma } from "@/server/prisma";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 400 });
  }

  const rawBody = await request.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid signature: ${err instanceof Error ? err.message : "unknown error"}` },
      { status: 400 },
    );
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const checkoutSession = event.data.object as Stripe.Checkout.Session;
      const plexoUserId = checkoutSession.metadata?.plexoUserId;
      if (!plexoUserId) break;

      if (checkoutSession.mode === "payment" && checkoutSession.metadata?.kind === "topup") {
        const credits = Number(checkoutSession.metadata.credits ?? 0);
        if (credits > 0) {
          await grantTopup(
            plexoUserId,
            credits,
            event.id,
            `Top-up purchase (${checkoutSession.metadata.pack ?? "credits"})`,
          );
        }
      }
      // Subscription-mode sessions don't carry the confirmed plan reliably here —
      // customer.subscription.created/updated below is the source of truth for that.
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const plexoUserId = subscription.metadata?.plexoUserId;
      const plan = subscription.metadata?.plan as SubscriptionPlan | undefined;
      if (!plexoUserId || !plan) break;
      if (subscription.status !== "active" && subscription.status !== "trialing") break;

      await prisma.user.update({
        where: { id: plexoUserId },
        data: { subscriptionPlan: plan, stripeSubscriptionId: subscription.id },
      });
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const plexoUserId = subscription.metadata?.plexoUserId;
      if (!plexoUserId) break;

      await prisma.user.update({
        where: { id: plexoUserId },
        data: { subscriptionPlan: "FREE", stripeSubscriptionId: null },
      });
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
