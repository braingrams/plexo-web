import Stripe from "stripe";

const STRIPE_API_VERSION = "2026-06-24.dahlia";

/**
 * Creates a Stripe Checkout Session for a Commerce order — used by both PLATFORM_STRIPE
 * (Plexo's own ops-controlled account) and BYO_STRIPE (a site's own account) call sites;
 * the caller resolves which secret key applies (see lib/commerce/stripe.ts) and passes it
 * in explicitly. Deliberately no cached/singleton client here — a BYO site's key varies
 * per request, so constructing a fresh Stripe instance per call is the only option that
 * works for both providers; the cost of doing so is negligible next to the network round
 * trip this function already makes.
 *
 * Deliberately a SEPARATE Stripe account from lib/stripe.ts's getStripe(), which is
 * Plexo's own SaaS-billing Stripe account (subscriptions, AI credit top-ups, marketplace
 * payouts) — mixing them would put customer Commerce charges through the same account and
 * webhook that handles Plexo's own billing, corrupting both.
 *
 * `ui_mode: "embedded_page"` — card entry renders inline in the storefront (see
 * public/commerce.js's checkout flow) instead of navigating off to checkout.stripe.com,
 * same embedded-Checkout treatment every other Stripe payment in this codebase now gets
 * (platform billing, marketplace template purchase). Returns `{ id, clientSecret }` — `id`
 * gets stamped on CommerceOrder.stripeCheckoutSessionId (what a webhook looks the order up
 * by on checkout.session.completed), `clientSecret` is what the storefront needs to mount
 * Stripe.js's embedded Checkout. Stripe still does one final navigation to `returnUrl` once
 * payment completes — that part of embedded Checkout isn't avoidable — landing back on the
 * same /order-confirmation page the old redirect flow already used.
 */
export async function createCommerceStripeCheckoutSession(input: {
  secretKey: string;
  orderId: string;
  templateId: string;
  amountMinor: number;
  currency: string;
  customerEmail: string;
  productName: string;
  returnUrl: string;
}): Promise<{ id: string; clientSecret: string }> {
  const stripe = new Stripe(input.secretKey, { apiVersion: STRIPE_API_VERSION });
  const session = await stripe.checkout.sessions.create({
    ui_mode: "embedded_page",
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
    return_url: input.returnUrl,
    // templateId travels alongside orderId so a per-site webhook route can resolve the
    // order without a table scan — see app/api/webhooks/stripe/commerce/[templateId]/route.ts.
    metadata: { orderId: input.orderId, templateId: input.templateId },
  });
  if (!session.client_secret) {
    throw new Error("Stripe did not return a checkout client secret.");
  }
  return { id: session.id, clientSecret: session.client_secret };
}
