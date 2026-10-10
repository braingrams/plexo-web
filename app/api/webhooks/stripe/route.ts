import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import type { EntityItem } from "electrodb";

import { grantTopup, grantPlanChangeAllowance } from "@/lib/db/ledgerOperations";
import { creditsForCompletedTopup } from "@/lib/credits/topupOffer";
import { getStripe } from "@/lib/stripe";
import type { SubscriptionPlan } from "@/lib/subscription";
import { getMarketplaceOwnerUserId } from "@/lib/marketplaceListing";
import { docClient } from "@/lib/db/client";
import { User, PlatformSettings, Member } from "@/lib/db/coreEntities";
import { TemplatePurchase } from "@/lib/db/contentEntities";
import { SellerLedgerEntry, StripeEvent } from "@/lib/db/ledgerEntities";
import { handleLmsAddonSlotSubscriptionUpdate, handleLmsAddonSlotSubscriptionDeleted } from "@/lib/lms/activateFunnelAddonSlot";
import { reconcileFunnelSlotsForOrg } from "@/lib/lms/funnelSlots";
import { mapStripeStatus, syncPlanLifecycle } from "@/lib/plan/lifecycle";

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

/** A plan is billed per-User, but funnel slots are counted per-Org (LmsFunnel.organizationId)
 * — reconcile every org this user OWNS (not just belongs to; a non-owner member's own plan
 * changing shouldn't touch an org's funnel capacity, same reasoning
 * getOrganizationOwnerPlanDynamo already applies elsewhere). */
async function reconcileFunnelSlotsForOwnedOrgs(userId: string): Promise<void> {
  const { data: memberships } = await Member.query.byUser({ userId }).go({ pages: "all" });
  const ownedOrgIds = memberships.filter((m) => m.role === "owner").map((m) => m.organizationId);
  await Promise.all(ownedOrgIds.map((organizationId) => reconcileFunnelSlotsForOrg(organizationId)));
}

/** The event is already claimed, so a failure here mustn't fail the webhook (Stripe's
 * retry would be skipped as a duplicate). The facts are saved; the next dashboard load,
 * site visit or hourly sweep finishes whatever this couldn't (lib/plan/lifecycle.ts). */
async function syncAfterWebhook(userId: string): Promise<void> {
  await syncPlanLifecycle(userId).catch((err) => console.error(`plan lifecycle after Stripe webhook failed for ${userId}`, err));
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
        // Half of what was actually paid (before tax) becomes AI credits — lib/credits/value.ts.
        // The checkout-time estimate in metadata is only a fallback (non-USD sessions).
        const credits = creditsForCompletedTopup(checkoutSession) ?? Number(checkoutSession.metadata.credits ?? 0);
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

      if (subscription.metadata?.kind === "lms_addon_slot") {
        await handleLmsAddonSlotSubscriptionUpdate(subscription);
        break;
      }

      const plexoUserId = subscription.metadata?.plexoUserId;
      const plan = subscription.metadata?.plan as SubscriptionPlan | undefined;
      if (!plexoUserId || !plan) break;

      const { data: userBeforeUpdate } = await User.get({ id: plexoUserId }).go();
      if (!userBeforeUpdate) break;
      const status = mapStripeStatus(subscription.status);

      if (status === "PAST_DUE" || status === "CANCELED") {
        // Only the account's CURRENT subscription speaks for its plan — an older one
        // (replaced by an upgrade) going past due or ending changes nothing. PAST_DUE keeps
        // the plan while Stripe retries the card; CANCELED (unpaid, expired) ends it, and
        // the lifecycle downgrades — unless an admin keeps this account on its plan.
        if (userBeforeUpdate.stripeSubscriptionId === subscription.id) {
          await User.patch({ id: plexoUserId }).set({ subscriptionStatus: status }).go();
          await syncAfterWebhook(plexoUserId);
        }
        break;
      }

      // Read the plan as it stood BEFORE this update, so an allowance refresh only fires
      // on a genuine plan change — not on every unrelated "customer.subscription.updated"
      // (a payment method swap, a metadata edit, etc.) that happens to match this same
      // event type.
      const previousPlan = userBeforeUpdate.subscriptionPlan;

      // Clears pendingPlan unconditionally on any confirmed active/trialing subscription,
      // even if it doesn't match what was originally picked at signup (e.g. the user
      // changed their mind and paid for a different plan) — requiring an exact match would
      // create a stuck "never lets them in" state instead. A paid subscription also ends
      // any trial or time-limited grant: from here the subscription is what counts.
      await User.patch({ id: plexoUserId })
        .set({ subscriptionPlan: plan, stripeSubscriptionId: subscription.id, subscriptionStatus: status })
        .remove(["pendingPlan", "planAccessUntil", "planAccessSource", "planAccessReminderSentAt"])
        .go();

      // The subscriptionPlan patch above alone left the AI credit allowance untouched —
      // ensureCreditPeriod() (lib/db/ledgerOperations.ts) only grants a fresh allowance
      // once the CURRENT period naturally expires, so an upgrade mid-period kept showing
      // the OLD (smaller) plan's balance for up to a month. Force it immediately here,
      // once, only on an actual change.
      if (previousPlan !== plan) {
        await grantPlanChangeAllowance(plexoUserId, plan);
        // A downgrade can drop the plan's included funnel-slot allotment (only Ultra ships
        // one) — reconcile every org this user owns, same mechanism an addon-slot
        // cancellation uses. A same-or-higher plan change is a harmless no-op here (nothing
        // is over budget), so this isn't gated further on which direction the change went.
        await reconcileFunnelSlotsForOwnedOrgs(plexoUserId);
      }
      // Coming back from Free: every page, site and custom domain the downgrade took
      // offline is restored right now, exactly as it was.
      await syncAfterWebhook(plexoUserId);
      break;
    }

    case "customer.subscription.deleted": {
      if (!(await claimStripeEvent(event.id))) break;

      const subscription = event.data.object as Stripe.Subscription;

      if (subscription.metadata?.kind === "lms_addon_slot") {
        await handleLmsAddonSlotSubscriptionDeleted(subscription);
        break;
      }

      const plexoUserId = subscription.metadata?.plexoUserId;
      if (!plexoUserId) break;

      // An upgrade (Pro → Ultra) creates a new subscription and ends the old one — that
      // old one ending must not drop the account to Free. Only the current one counts.
      const { data: current } = await User.get({ id: plexoUserId }).go();
      if (!current || (current.stripeSubscriptionId && current.stripeSubscriptionId !== subscription.id)) break;

      // Record the fact; the lifecycle does the rest — Free's limits (one live site,
      // homepage only, custom domains paused, nothing deleted), the email, credits and
      // funnel slots. An account an admin keeps on its plan stays on it.
      await User.patch({ id: plexoUserId })
        .set({ subscriptionStatus: "CANCELED" })
        .remove(["stripeSubscriptionId", "pendingPlan"])
        .go();
      await syncAfterWebhook(plexoUserId);
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
