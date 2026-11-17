import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import type { EntityItem } from "electrodb";

import { grantTopup, grantPlanChangeAllowance } from "@/lib/db/ledgerOperations";
import { creditsForCompletedTopup } from "@/lib/credits/topupOffer";
import { loadPriceBook } from "@/lib/billing/priceBook";
import { getStripe } from "@/lib/stripe";
import { syncPlanChangeToAlps } from "@/lib/alps";
import { planFromStripeSubscription } from "@/lib/billing/stripePlans";
import { allowancePlan, storedPlan } from "@/lib/plan/entitlement";
import { planFields } from "@/lib/plan/plans";
import { getMarketplaceOwnerUserId } from "@/lib/marketplaceListing";
import { docClient } from "@/lib/db/client";
import { User, PlatformSettings, Member } from "@/lib/db/coreEntities";
import { TemplatePurchase } from "@/lib/db/contentEntities";
import { SellerLedgerEntry, StripeEvent } from "@/lib/db/ledgerEntities";
import { handleLmsAddonSlotSubscriptionUpdate, handleLmsAddonSlotSubscriptionDeleted } from "@/lib/lms/activateFunnelAddonSlot";
import { reconcileFunnelSlotsForOrg } from "@/lib/lms/funnelSlots";
import { mapStripeStatus, sendPaymentDeclinedEmail, syncPlanLifecycle } from "@/lib/plan/lifecycle";
import { isSettled, recordStripeCharge, sendReceiptEmail } from "@/lib/billing/payments";
import { retireSupersededPlanSubscriptions } from "@/lib/billing/planChange";

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
        // Credits at the flat top-up rate for what was actually paid (before tax) —
        // lib/billing/pricing.ts. The checkout-time amount in metadata is only a fallback.
        const credits = creditsForCompletedTopup(checkoutSession, await loadPriceBook()) ?? Number(checkoutSession.metadata.credits ?? 0);
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

    // Plexo's own record of every payment (lib/billing/payments.ts) — what receipts, the
    // owner's payment history and the admin console read. Not event-claimed: recording is
    // idempotent (the row is keyed by the charge id), and a failure should make Stripe retry.
    case "charge.succeeded":
    case "charge.failed":
    case "charge.refunded":
    case "charge.updated": {
      const charge = event.data.object as Stripe.Charge;
      const recorded = await recordStripeCharge(stripe, charge);
      // Email the receipt once, automatically — only for payments made in the last two days,
      // so a refund event for an old charge never sends a surprise receipt for it.
      const recent = Date.now() - charge.created * 1000 < 2 * 86_400_000;
      if (recorded && recent && isSettled(recorded.payment.status) && !recorded.payment.receiptEmailedAt) {
        await sendReceiptEmail(recorded.payment, { onceOnly: true }).catch((err) => console.error(`receipt email for ${charge.id} failed`, err));
      }
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
      // In today's plan terms: a subscription from before the 2026 rename (metadata.plan
      // PRO/ULTRA, no planVersion) reads as Starter/Pro — forever, on every renewal.
      const plan = planFromStripeSubscription(subscription);
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

      // Safety net against double billing: one customer, one live plan subscription. If a
      // second one exists (two checkouts at once, an old client, a manual Stripe edit) the
      // older is cancelled with its unused time credited. If THIS event is for the one that
      // was just cancelled it must not touch the account — it would overwrite the plan the
      // newer subscription already set (an old Pro renewing once reset an Ultra account to Pro).
      const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
      if (customerId) {
        const retired = await retireSupersededPlanSubscriptions(stripe, customerId).catch((err) => {
          console.error(`superseded-subscription check failed for ${customerId}`, err);
          return [] as string[];
        });
        if (retired.includes(subscription.id)) break;
      }

      // Read the plan as it stood BEFORE this update, so an allowance refresh only fires
      // on a genuine plan change — not on every unrelated "customer.subscription.updated"
      // (a payment method swap, a metadata edit, etc.) that happens to match this same
      // event type.
      const previousPlan = storedPlan(userBeforeUpdate);
      // A trial adds no AI credits, so a trial turning into the same paid plan still refreshes them.
      const previousAllowancePlan = allowancePlan(userBeforeUpdate);

      // Clears pendingPlan unconditionally on any confirmed active/trialing subscription,
      // even if it doesn't match what was originally picked at signup (e.g. the user
      // changed their mind and paid for a different plan) — requiring an exact match would
      // create a stuck "never lets them in" state instead. A paid subscription also ends
      // any trial or time-limited grant: from here the subscription is what counts.
      const item = subscription.items?.data?.[0];
      const periodEnd = item?.current_period_end;
      const interval = item?.price?.recurring?.interval === "year" ? "yearly" : "monthly";
      // A plan move booked for the renewal (scripts/billing/migrate-plans.ts) is done once the
      // subscription is on that plan's new price (metadata planVersion 2).
      const scheduledDone = !!userBeforeUpdate.scheduledPlan && subscription.metadata?.planVersion === "2";
      await User.patch({ id: plexoUserId })
        .set({
          ...planFields(plan),
          stripeSubscriptionId: subscription.id,
          subscriptionProvider: "STRIPE",
          subscriptionId: subscription.id,
          subscriptionInterval: interval,
          ...(subscription.metadata?.region ? { billingRegion: subscription.metadata.region } : {}),
          ...(userBeforeUpdate.billingCurrency ? {} : { billingCurrency: "USD" as const }),
          ...(userBeforeUpdate.billingRegionLockedAt ? {} : { billingRegionLockedAt: new Date().toISOString() }),
          subscriptionStatus: status,
          ...(subscription.start_date ? { subscriptionStartedAt: new Date(subscription.start_date * 1000).toISOString() } : {}),
          subscriptionCancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
          ...(periodEnd ? { subscriptionPeriodEnd: new Date(periodEnd * 1000).toISOString() } : {}),
        })
        .remove(["pendingPlan", "planAccessUntil", "planAccessSource", "planAccessReminderSentAt", ...(scheduledDone ? (["scheduledPlan", "scheduledPlanAt"] as const) : [])])
        .go();

      // The subscriptionPlan patch above alone left the AI credit allowance untouched —
      // ensureCreditPeriod() (lib/db/ledgerOperations.ts) only grants a fresh allowance
      // once the CURRENT period naturally expires, so an upgrade mid-period kept showing
      // the OLD (smaller) plan's balance for up to a month. Force it immediately here,
      // once, only on an actual change.
      if (previousPlan !== plan || previousAllowancePlan !== plan) {
        syncPlanChangeToAlps({ id: plexoUserId, email: userBeforeUpdate.email, name: userBeforeUpdate.name, image: userBeforeUpdate.image }, plan, subscription.id);
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

    // A monthly renewal was declined: tell the owner right away, once (the first failed attempt),
    // so they can fix their card. The plan stays fully active while Stripe retries; if every retry
    // fails the subscription ends and the plan-ended email explains what went offline.
    case "invoice.payment_failed": {
      if (!(await claimStripeEvent(event.id))) break;
      const invoice = event.data.object as unknown as {
        billing_reason?: string;
        attempt_count?: number;
        amount_due?: number;
        currency?: string;
        next_payment_attempt?: number | null;
        subscription?: string | { id: string } | null;
        parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
      };
      if (invoice.billing_reason !== "subscription_cycle" || (invoice.attempt_count ?? 1) > 1) break;
      try {
        const ref = invoice.subscription ?? invoice.parent?.subscription_details?.subscription;
        const subscriptionId = typeof ref === "string" ? ref : ref?.id;
        if (!subscriptionId) break;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const plexoUserId = subscription.metadata?.plexoUserId;
        if (!plexoUserId || !planFromStripeSubscription(subscription)) break;
        const { data: user } = await User.get({ id: plexoUserId }).go();
        // Only the account's current subscription speaks for it (an old one being retired doesn't).
        if (!user || user.stripeSubscriptionId !== subscription.id) break;
        await sendPaymentDeclinedEmail(user, {
          amountMinor: invoice.amount_due,
          currency: invoice.currency,
          retryAt: invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000).toISOString() : null,
        });
      } catch (err) {
        console.error("declined-payment email failed", err); // best effort — never fail the webhook after claiming the event
      }
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

      // A superseded plan subscription being cancelled (retireSupersededPlanSubscriptions)
      // must not drop the account to Free. Only the current one counts.
      const { data: current } = await User.get({ id: plexoUserId }).go();
      if (!current || (current.stripeSubscriptionId && current.stripeSubscriptionId !== subscription.id)) break;

      // Record the fact; the lifecycle does the rest — Free's limits (one live site,
      // homepage only, custom domains paused, nothing deleted), the email, credits and
      // funnel slots. An account an admin keeps on its plan stays on it.
      await User.patch({ id: plexoUserId })
        .set({ subscriptionStatus: "CANCELED" })
        .remove(["stripeSubscriptionId", "subscriptionId", "pendingPlan", "scheduledPlan", "scheduledPlanAt"])
        .go();
      await syncAfterWebhook(plexoUserId);
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
