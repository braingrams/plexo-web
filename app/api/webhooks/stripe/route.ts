import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { Prisma } from "@prisma/client";

import { grantTopup } from "@/lib/credits/ledger";
import { getStripe } from "@/lib/stripe";
import type { SubscriptionPlan } from "@/lib/subscription";
import { getMarketplaceOwnerUserId } from "@/lib/marketplaceListing";
import { prisma } from "@/server/prisma";

/**
 * Credits a marketplace seller their share of a sale, minus the admin-configurable
 * platform fee (PlatformSettings.marketplaceFeeBps, default 20%). Called only right after
 * the TemplatePurchase row is successfully created for the first time — a webhook retry
 * that hits the P2002 catch on that create skips this too, which is correct: both effects
 * belong to the same one-time sale event.
 */
async function creditMarketplaceSeller(sellerUserId: string, priceCents: number, templatePurchaseId: string): Promise<void> {
  const systemOwnerId = await getMarketplaceOwnerUserId();
  if (sellerUserId === systemOwnerId) return; // admin-curated listing — no real seller to pay

  const settings = await prisma.platformSettings.upsert({
    where: { id: "global" },
    create: { id: "global" },
    update: {},
    select: { marketplaceFeeBps: true },
  });
  const feeCents = Math.round((priceCents * settings.marketplaceFeeBps) / 10_000);
  const netAmountCents = priceCents - feeCents;

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: sellerUserId },
      data: { sellerBalanceCents: { increment: netAmountCents } },
      select: { sellerBalanceCents: true },
    });

    await tx.sellerLedgerEntry.create({
      data: {
        userId: sellerUserId,
        type: "SALE_CREDIT",
        grossAmountCents: priceCents,
        feeCents,
        netAmountCents,
        balanceAfterCents: user.sellerBalanceCents,
        templatePurchaseId,
        description: "Marketplace sale",
      },
    });
  });
}

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

      if (checkoutSession.mode === "payment" && checkoutSession.metadata?.kind === "template_purchase") {
        const templateId = checkoutSession.metadata.templateId;
        const priceCents = Number(checkoutSession.metadata.priceCents ?? 0);
        const sellerUserId = checkoutSession.metadata?.sellerUserId;
        if (templateId) {
          try {
            const purchase = await prisma.templatePurchase.create({
              data: {
                userId: plexoUserId,
                templateId,
                priceCentsPaid: priceCents,
                stripeSessionId: checkoutSession.id,
              },
            });
            if (sellerUserId && priceCents > 0) {
              await creditMarketplaceSeller(sellerUserId, priceCents, purchase.id);
            }
          } catch (err) {
            // P2002 = already recorded (webhook retry, or the unique userId+templateId
            // constraint) — anything else is a real failure worth surfacing. Either way,
            // skip seller-crediting too: a retry means this sale was already credited once.
            if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
          }
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
