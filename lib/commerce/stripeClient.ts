import Stripe from "stripe";

let client: Stripe | null = null;

/**
 * Lazily-constructed singleton for Plexo's OWN platform-hosted Commerce Stripe account —
 * deliberately a SEPARATE client/key from lib/stripe.ts's getStripe(), which is Plexo's own
 * SaaS-billing Stripe account (subscriptions, AI credit top-ups, marketplace payouts).
 * Mixing them would put customer Commerce charges through the same account and webhook
 * that handles Plexo's own billing, corrupting both. v1 uses one Plexo-ops-controlled key
 * (PLATFORM_COMMERCE_STRIPE_SECRET_KEY), no per-site test/live split and no BYO-Stripe-keys
 * option — see CommercePaymentProvider's own comment.
 */
function getCommerceStripe(): Stripe {
  if (client) return client;
  const secretKey = process.env.PLATFORM_COMMERCE_STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("PLATFORM_COMMERCE_STRIPE_SECRET_KEY is not configured.");
  }
  client = new Stripe(secretKey, { apiVersion: "2026-06-24.dahlia" });
  return client;
}

/**
 * Creates a Stripe Checkout Session for a PLATFORM_STRIPE Commerce order. Returns
 * `{ id, url }` — `id` gets stamped on CommerceOrder.stripeCheckoutSessionId (what the
 * webhook looks the order up by on checkout.session.completed), `url` is handed back to the
 * browser the same way Paystack's authorizationUrl already is (commerce.js reads
 * `authorizationUrl` regardless of which provider produced it, so the front end needs no
 * per-provider branching).
 */
export async function createCommerceStripeCheckoutSession(input: {
  orderId: string;
  amountMinor: number;
  currency: string;
  customerEmail: string;
  productName: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string }> {
  const stripe = getCommerceStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: input.customerEmail,
    line_items: [
      {
        price_data: {
          currency: input.currency.toLowerCase(),
          product_data: { name: input.productName },
          unit_amount: input.amountMinor,
        },
        quantity: 1,
      },
    ],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: { orderId: input.orderId },
  });
  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }
  return { id: session.id, url: session.url };
}
