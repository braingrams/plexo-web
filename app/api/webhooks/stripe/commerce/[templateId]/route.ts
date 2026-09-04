import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

import { decryptStripeKey, tryDecrypt } from "@/lib/crypto";
import { listConfiguredStripeWebhookSecrets, resolveStripeKeysForMode } from "@/lib/commerce/stripe";
import { handleOrderPaid } from "@/lib/db/commerceWebhookOperations";
import { CommerceOrder, CommerceBooking, CommerceSettings, StripeCommerceEvent } from "@/lib/db/commerceEntities";

const STRIPE_API_VERSION = "2026-06-24.dahlia";

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

/**
 * Webhook for orders paid through a site's OWN (BYO) Stripe account — deliberately
 * separate from app/api/webhooks/stripe/commerce/route.ts, which handles ONLY
 * Plexo's platform-hosted Commerce Stripe account (a single shared secret, a single
 * shared URL). A BYO site owner points their own Stripe Dashboard's webhook config at
 * THIS templateId-scoped URL (shown to them in Settings > Payments), signed with their
 * own webhook secret(s).
 *
 * Order lookup is templateId-scoped (this URL segment), not a full-table Scan the way
 * the platform route's is — CommerceOrder has no stripeCheckoutSessionId index, but a
 * single site's own order volume is small enough that filtering in JS after one
 * query.primary({templateId}) is strictly better than scanning the whole table.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  if (!settings) {
    return NextResponse.json({ error: "Not configured." }, { status: 404 });
  }

  const stripeFields = {
    stripeMode: settings.stripeMode ?? "TEST",
    stripeTestPublishableKey: settings.stripeTestPublishableKey ?? null,
    stripeTestSecretKeyEncrypted: settings.stripeTestSecretKeyEncrypted ?? null,
    stripeTestWebhookSecretEncrypted: settings.stripeTestWebhookSecretEncrypted ?? null,
    stripeLivePublishableKey: settings.stripeLivePublishableKey ?? null,
    stripeLiveSecretKeyEncrypted: settings.stripeLiveSecretKeyEncrypted ?? null,
    stripeLiveWebhookSecretEncrypted: settings.stripeLiveWebhookSecretEncrypted ?? null,
  } as const;

  const configuredSecrets = listConfiguredStripeWebhookSecrets(stripeFields);
  if (configuredSecrets.length === 0) {
    return NextResponse.json({ error: "Not configured." }, { status: 404 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const rawBody = await request.text();

  // A site may have both a Test and a Live Stripe dashboard pointed at this same URL (or
  // be mid mode-switch with a transaction from the previously-active mode still settling)
  // — try every configured webhook secret rather than only whichever mode is currently
  // toggled active, same reasoning as the Paystack per-site webhook route.
  let event: Stripe.Event | null = null;
  for (const candidate of configuredSecrets) {
    const webhookSecret = tryDecrypt(() => decryptStripeKey(candidate.webhookSecretEncrypted));
    if (!webhookSecret) continue;
    const { secretKeyEncrypted } = resolveStripeKeysForMode(stripeFields, candidate.mode);
    const apiSecretKey = secretKeyEncrypted ? tryDecrypt(() => decryptStripeKey(secretKeyEncrypted)) : null;
    if (!apiSecretKey) continue;
    try {
      const stripe = new Stripe(apiSecretKey, { apiVersion: STRIPE_API_VERSION });
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      break;
    } catch {
      // wrong secret for this candidate — try the next one
    }
  }
  if (!event) {
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

    const { data: orders } = await CommerceOrder.query.primary({ templateId }).go({ pages: "all" });
    const orderRef = orders.find((o) => o.stripeCheckoutSessionId === session.id);

    if (orderRef && orderRef.paymentProvider === "BYO_STRIPE") {
      try {
        await CommerceOrder.patch({ templateId, id: orderRef.id })
          .set({ status: "PAID", stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : undefined })
          .where((attr, op) => op.eq(attr.status, "PENDING"))
          .go();
      } catch (err) {
        if (!isConditionalCheckFailure(err)) throw err;
        return NextResponse.json({ received: true }); // already moved past PENDING
      }

      const [{ data: order }, { data: booking }] = await Promise.all([
        CommerceOrder.get({ templateId, id: orderRef.id }).go(),
        CommerceBooking.get({ templateId, orderId: orderRef.id }).go(),
      ]);

      // Deliberately no creditCommerceWallet call here — BYO Stripe money lands directly
      // in the site's own Stripe account and never touches Plexo's ledger; wallet crediting
      // is a PLATFORM_*-only concept (see the platform route).
      if (order) {
        await handleOrderPaid(order, booking, settings);
      }
    }
  }

  return NextResponse.json({ received: true });
}
