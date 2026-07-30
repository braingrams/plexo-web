import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";

import { grantTopup } from "@/lib/credits/ledger";
import { getStripe } from "@/lib/stripe";
import type { SubscriptionPlan } from "@/lib/subscription";
import { prisma } from "@/server/prisma";

// Idempotency guard for Stripe's at-least-once webhook delivery, same pattern as
// lib/credits/ledger.ts's grantTopup: claim the event id via a standalone insert BEFORE
// doing any mutation — a unique-constraint violation means it's already been processed.
async function claimStripeEvent(eventId: string): Promise<boolean> {
  try {
    await prisma.stripeEvent.create({ data: { id: eventId } });
    return true;
  } catch {
    return false;
  }
}

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
      if (!(await claimStripeEvent(event.id))) break;

      const subscription = event.data.object as Stripe.Subscription;
      const plexoUserId = subscription.metadata?.plexoUserId;
      const plan = subscription.metadata?.plan as SubscriptionPlan | undefined;
      if (!plexoUserId || !plan) break;
      if (subscription.status !== "active" && subscription.status !== "trialing") break;

      await prisma.user.update({
        where: { id: plexoUserId },
        // Clears pendingPlan unconditionally on any confirmed active/trialing subscription,
        // even if it doesn't match what was originally picked at signup (e.g. the user
        // changed their mind and paid for a different plan) — requiring an exact match would
        // create a stuck "never lets them in" state instead.
        data: { subscriptionPlan: plan, stripeSubscriptionId: subscription.id, pendingPlan: null },
      });
      break;
    }

    case "customer.subscription.deleted": {
      if (!(await claimStripeEvent(event.id))) break;

      const subscription = event.data.object as Stripe.Subscription;
      const plexoUserId = subscription.metadata?.plexoUserId;
      if (!plexoUserId) break;

      await prisma.user.update({
        where: { id: plexoUserId },
        data: { subscriptionPlan: "FREE", stripeSubscriptionId: null, pendingPlan: null },
      });
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
