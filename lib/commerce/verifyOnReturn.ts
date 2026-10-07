import Stripe from "stripe";
import type { EntityItem } from "electrodb";
import { decryptPaystackKey } from "@/lib/crypto";
import { resolvePaystackKeysForMode } from "@/lib/commerce/paystack";
import { attachStripeSubscriptionToDonation, resolveDonationGateway } from "@/lib/commerce/donations";
import { creditCommerceWallet } from "@/lib/commerce/walletDynamo";
import { handleOrderPaid } from "@/lib/db/commerceWebhookOperations";
import { CommerceBooking, CommerceOrder, CommerceSettings } from "@/lib/db/commerceEntities";

// Webhooks are how Plexo normally learns a payment succeeded — but an owner who connected
// their own Paystack/Stripe keys and never pasted Plexo's webhook URL into their gateway
// dashboard (an easy step to miss) would see every order stay "pending" forever even
// though the money arrived. So when a customer/donor lands back on the site after paying,
// Plexo also asks the gateway directly. It goes through the exact same conditional
// PENDING → PAID write as the webhooks, so whichever arrives first wins and the other is a
// no-op: nothing is ever counted, emailed or credited twice.

type OrderItem = EntityItem<typeof CommerceOrder>;

const STRIPE_API_VERSION = "2026-06-24.dahlia";

function isConditionalCheckFailure(err: unknown): boolean {
  const e = err as { name?: string; cause?: { name?: string } };
  return e?.name === "ConditionalCheckFailedException" || e?.cause?.name === "ConditionalCheckFailedException";
}

async function paystackSucceeded(order: OrderItem, settings: EntityItem<typeof CommerceSettings>): Promise<boolean> {
  if (!order.paystackReference) return false;
  let secret: string | null = null;
  if (order.paymentProvider === "PLATFORM_PAYSTACK") {
    secret = process.env.PLATFORM_PAYSTACK_SECRET_KEY ?? null;
  } else if (order.paystackMode) {
    const keys = resolvePaystackKeysForMode(
      {
        paystackTestPublicKey: settings.paystackTestPublicKey ?? null,
        paystackTestSecretKeyEncrypted: settings.paystackTestSecretKeyEncrypted ?? null,
        paystackLivePublicKey: settings.paystackLivePublicKey ?? null,
        paystackLiveSecretKeyEncrypted: settings.paystackLiveSecretKeyEncrypted ?? null,
      },
      order.paystackMode,
    );
    secret = keys?.secretKeyEncrypted ? decryptPaystackKey(keys.secretKeyEncrypted) : null;
  }
  if (!secret) return false;
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(order.paystackReference)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = (await res.json().catch(() => null)) as { status?: boolean; data?: { status?: string; amount?: number; currency?: string } } | null;
  const tx = body?.data;
  // The amount and currency must match what Plexo asked for — never trust a mismatched charge.
  return Boolean(body?.status && tx?.status === "success" && tx.amount === order.amountMinor && (!tx.currency || tx.currency.toUpperCase() === (order.currency ?? "NGN").toUpperCase()));
}

async function stripeSucceeded(order: OrderItem, settings: EntityItem<typeof CommerceSettings>): Promise<{ paymentIntentId: string | null; subscriptionId: string | null } | null> {
  if (!order.stripeCheckoutSessionId) return null;
  const stripeKeys = resolveDonationGateway(settings).stripe;
  if (!stripeKeys) return null;
  const stripe = new Stripe(stripeKeys.secretKey, { apiVersion: STRIPE_API_VERSION });
  const session = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
  if (session.status !== "complete" || (session.payment_status !== "paid" && session.payment_status !== "no_payment_required")) return null;
  if (session.amount_total !== null && session.amount_total !== order.amountMinor) return null;
  return {
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
    subscriptionId: typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null,
  };
}

/**
 * Confirms a still-PENDING online order with its gateway. Returns the order's status
 * afterwards. Never throws for gateway hiccups — the webhook remains the backstop.
 */
export async function verifyOrderOnReturn(order: OrderItem): Promise<string> {
  if (order.status !== "PENDING" || order.paymentMethod === "BANK_TRANSFER") return order.status ?? "PENDING";
  const { data: settings } = await CommerceSettings.get({ templateId: order.templateId }).go();
  if (!settings) return "PENDING";
  try {
    const isStripe = order.paymentProvider === "BYO_STRIPE" || order.paymentProvider === "PLATFORM_STRIPE";
    let stripeRefs: { paymentIntentId: string | null; subscriptionId: string | null } | null = null;
    if (isStripe) {
      stripeRefs = await stripeSucceeded(order, settings);
      if (!stripeRefs) return "PENDING";
    } else if (!(await paystackSucceeded(order, settings))) {
      return "PENDING";
    }

    try {
      await CommerceOrder.patch({ templateId: order.templateId, id: order.id })
        .set({ status: "PAID", ...(stripeRefs?.paymentIntentId ? { stripePaymentIntentId: stripeRefs.paymentIntentId } : {}) })
        .where((attr, op) => op.eq(attr.status, "PENDING"))
        .go();
    } catch (err) {
      if (isConditionalCheckFailure(err)) return "PAID"; // the webhook got there first
      throw err;
    }

    const [{ data: paid }, { data: booking }] = await Promise.all([
      CommerceOrder.get({ templateId: order.templateId, id: order.id }).go(),
      CommerceBooking.get({ templateId: order.templateId, orderId: order.id }).go(),
    ]);
    if (paid) {
      if (stripeRefs?.subscriptionId) await attachStripeSubscriptionToDonation(paid, stripeRefs.subscriptionId);
      await handleOrderPaid(paid, booking, settings);
      if (paid.paymentProvider === "PLATFORM_STRIPE" || paid.paymentProvider === "PLATFORM_PAYSTACK") {
        await creditCommerceWallet(paid).catch((err) => console.error("Commerce: wallet credit on return failed", err));
      }
    }
    return "PAID";
  } catch (err) {
    console.error("Commerce: verify-on-return failed", err);
    return "PENDING";
  }
}
