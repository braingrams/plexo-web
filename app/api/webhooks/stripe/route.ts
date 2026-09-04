import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import type { EntityItem } from "electrodb";

import { grantTopup, grantPlanChangeAllowance } from "@/lib/db/ledgerOperations";
import { getStripe } from "@/lib/stripe";
import type { SubscriptionPlan } from "@/lib/subscription";
import { getMarketplaceOwnerUserId } from "@/lib/marketplaceListing";
import { docClient } from "@/lib/db/client";
import { User, PlatformSettings } from "@/lib/db/coreEntities";
import { TemplatePurchase } from "@/lib/db/contentEntities";
import { SellerLedgerEntry, StripeEvent } from "@/lib/db/ledgerEntities";

// DynamoDB-stack port of this file — Plexo's own SaaS-billing Stripe webhook (distinct
// from app/api/webhooks/stripe/commerce/route.ts, which handles Plexo-hosted Commerce
// checkouts on a separate Stripe account/secret). Same idempotency discipline as that
// file and lib/db/ledgerOperations.ts's grantTopup: claim the event id via a standalone
// `.create()` BEFORE any mutation — ElectroDB's attribute_not_exists condition on create
// gives the same "already processed" signal Prisma's P2002 did.

type UserItem = EntityItem<typeof User>;

const MAX_OPTIMISTIC_RETRIES = 5;

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

async function claimStripeEvent(eventId: string): Promise<boolean> {
  try {
    await StripeEvent.create({ id: eventId }).go();
    return true;
  } catch (err) {
    if (isConditionalCheckFailure(err)) return false; // already processed this Stripe event
    throw err;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTransactWrite(updateParams: any, putParams: any): TransactWriteCommand {
  return new TransactWriteCommand({
    TransactItems: [
      { Update: updateParams as unknown as NonNullable<TransactWriteCommandInput["TransactItems"]>[number]["Update"] },
      { Put: putParams as unknown as NonNullable<TransactWriteCommandInput["TransactItems"]>[number]["Put"] },
    ],
  });
}

/**
 * Credits a marketplace seller their share of a sale, minus the admin-configurable
 * platform fee (PlatformSettings.marketplaceFeeBps, default 20%). Called only right after
 * TemplatePurchase.create() succeeds for the first time — a webhook retry that hits the
 * ConditionalCheckFailedException on that create skips this too, which is correct: both
 * effects belong to the same one-time sale event.
 *
 * Same optimistic-lock-and-retry shape as lib/db/ledgerOperations.ts's grantTopup: DynamoDB's
 * TransactWriteItems has no RETURNING, so balanceAfterCents is computed from a value read
 * just before the transaction, guarded by a condition that it hasn't changed since.
 */
async function creditMarketplaceSeller(sellerUserId: string, priceCents: number, templatePurchaseId: string): Promise<void> {
  const systemOwnerId = await getMarketplaceOwnerUserId();
  if (sellerUserId === systemOwnerId) return; // admin-curated listing — no real seller to pay

  let settings = (await PlatformSettings.get({}).go()).data;
  if (!settings) {
    try {
      settings = (await PlatformSettings.create({}).go()).data;
    } catch (err) {
      if (!isConditionalCheckFailure(err)) throw err;
      settings = (await PlatformSettings.get({}).go()).data;
    }
  }
  const feeBps = settings?.marketplaceFeeBps ?? 2000;
  const feeCents = Math.round((priceCents * feeBps) / 10_000);
  const netAmountCents = priceCents - feeCents;

  for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
    const { data } = await User.get({ id: sellerUserId }).go();
    if (!data) throw new Error(`creditMarketplaceSeller: user ${sellerUserId} not found`);
    const user = data as UserItem;
    const currentBalance = user.sellerBalanceCents ?? 0;
    const balanceAfterCents = currentBalance + netAmountCents;

    const updateUser = User.patch({ id: sellerUserId })
      .set({ sellerBalanceCents: balanceAfterCents })
      .where((attr, op) => op.eq(attr.sellerBalanceCents, currentBalance)) // optimistic lock
      .params();

    const createEntry = SellerLedgerEntry.create({
      id: randomUUID(),
      userId: sellerUserId,
      type: "SALE_CREDIT",
      grossAmountCents: priceCents,
      feeCents,
      netAmountCents,
      balanceAfterCents,
      templatePurchaseId,
      description: "Marketplace sale",
    }).params();

    try {
      await docClient.send(buildTransactWrite(updateUser, createEntry));
      return;
    } catch (err) {
      if (isConditionalCheckFailure(err) && attempt < MAX_OPTIMISTIC_RETRIES - 1) continue; // lost the race, retry
      throw err;
    }
  }

  throw new Error(`creditMarketplaceSeller: exhausted retries for user ${sellerUserId} — too much concurrent balance contention`);
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
          const purchaseId = randomUUID();
          try {
            await TemplatePurchase.create({
              id: purchaseId,
              userId: plexoUserId,
              templateId,
              priceCentsPaid: priceCents,
              stripeSessionId: checkoutSession.id,
            }).go();
            if (sellerUserId && priceCents > 0) {
              await creditMarketplaceSeller(sellerUserId, priceCents, purchaseId);
            }
          } catch (err) {
            // Already recorded (webhook retry, or the @@unique([userId, templateId]) the
            // primary key's own SK now enforces for free) — anything else is a real
            // failure worth surfacing. Either way, skip seller-crediting too: a retry
            // means this sale was already credited once.
            if (!isConditionalCheckFailure(err)) throw err;
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

      // Read the plan as it stood BEFORE this update, so an allowance refresh only fires
      // on a genuine plan change — not on every unrelated "customer.subscription.updated"
      // (a payment method swap, a metadata edit, etc.) that happens to match this same
      // event type.
      const { data: userBeforeUpdate } = await User.get({ id: plexoUserId }).go();
      const previousPlan = userBeforeUpdate?.subscriptionPlan;

      // Clears pendingPlan unconditionally on any confirmed active/trialing subscription,
      // even if it doesn't match what was originally picked at signup (e.g. the user
      // changed their mind and paid for a different plan) — requiring an exact match would
      // create a stuck "never lets them in" state instead.
      await User.patch({ id: plexoUserId })
        .set({ subscriptionPlan: plan, stripeSubscriptionId: subscription.id })
        .remove(["pendingPlan"])
        .go();

      // The subscriptionPlan patch above alone left the AI credit allowance untouched —
      // ensureCreditPeriod() (lib/db/ledgerOperations.ts) only grants a fresh allowance
      // once the CURRENT period naturally expires, so an upgrade mid-period kept showing
      // the OLD (smaller) plan's balance for up to a month. Force it immediately here,
      // once, only on an actual change.
      if (previousPlan !== plan) {
        await grantPlanChangeAllowance(plexoUserId, plan);
      }
      break;
    }

    case "customer.subscription.deleted": {
      if (!(await claimStripeEvent(event.id))) break;

      const subscription = event.data.object as Stripe.Subscription;
      const plexoUserId = subscription.metadata?.plexoUserId;
      if (!plexoUserId) break;

      await User.patch({ id: plexoUserId })
        .set({ subscriptionPlan: "FREE" })
        .remove(["stripeSubscriptionId", "pendingPlan"])
        .go();
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
