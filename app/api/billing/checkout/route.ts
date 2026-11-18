import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { ensureStripePlanPrice } from "@/lib/billing/stripePrices";
import { loadPriceBook } from "@/lib/billing/priceBook";
import { topupOffer } from "@/lib/credits/topupOffer";
import { billingRegionFor, regionLockFields } from "@/lib/billing/region";
import { stripePlanMetadata } from "@/lib/billing/stripePlans";
import { startPaystackPlanCheckout, startPaystackTopupCheckout } from "@/lib/billing/paystackBilling";
import { PLAN_LABELS, type PaidPlanId } from "@/lib/plan/plans";
import { storedPlan } from "@/lib/plan/entitlement";
import { yearlyOffered, type BillingInterval } from "@/lib/billing/pricing";
import { getStripe } from "@/lib/stripe";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { User } from "@/lib/db/coreEntities";
import { LmsFunnelAddonSlot } from "@/lib/db/contentEntities";
import { PlanChangeError, changePlanInPlace } from "@/lib/billing/planChange";

type CheckoutRequest =
  | { kind: "subscription"; plan: PaidPlanId | "ULTRA"; interval?: BillingInterval }
  | { kind: "topup"; pack: "SMALL" | "MEDIUM" | "LARGE" }
  | { kind: "funnel_addon_slot" };

function isValidBody(value: unknown): value is CheckoutRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  if (body.kind === "subscription") {
    if (body.interval !== undefined && body.interval !== "monthly" && body.interval !== "yearly") return false;
    // ULTRA: a page loaded before the plan rename (it means today's Pro).
    return body.plan === "STARTER" || body.plan === "PRO" || body.plan === "ENTERPRISE" || body.plan === "ULTRA";
  }
  if (body.kind === "topup") return body.pack === "SMALL" || body.pack === "MEDIUM" || body.pack === "LARGE";
  if (body.kind === "funnel_addon_slot") return true;
  return false;
}

// A same-origin, root-relative path only — this becomes part of a real Stripe-hosted
// return_url, so an absolute/protocol-relative/scheme-carrying value must never be
// trusted here (that would turn a completed-payment redirect into an open redirect to
// wherever a caller likes). Client-side billing-section.tsx applies the identical check
// before ever sending this; re-checked here since this is the actual trust boundary.
function isSafeReturnTo(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("://");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as unknown;
  if (!isValidBody(body)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { data: user } = await User.get({ id: session.user.id }).go();
  if (!user) throw new Error(`Session user ${session.user.id} has no matching User record`);

  // Which prices and which payment provider (lib/billing/pricing.ts): the account's saved
  // region, or where this request comes from until the first checkout saves it. Funnel slots
  // are a USD add-on through Stripe for everyone.
  // Read fresh: what's charged always matches the latest prices saved in admin.
  const book = await loadPriceBook({ fresh: true });
  const region = billingRegionFor(book, user, request.headers);
  const usesPaystack = region.provider === "PAYSTACK" && body.kind !== "funnel_addon_slot";
  if (body.kind !== "funnel_addon_slot") {
    const lock = regionLockFields(user, region, request.headers);
    if (lock) await User.patch({ id: session.user.id }).set(lock as never).go();
  }

  const stripe = usesPaystack ? null : getStripe();
  let customerId = user.stripeCustomerId;
  if (stripe && !customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { plexoUserId: session.user.id },
    });
    customerId = customer.id;
    await User.patch({ id: session.user.id }).set({ stripeCustomerId: customerId }).go();
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  // Was `/dashboard/settings?billing=success` — that path was never a real page (the
  // actual page lives at /dashboard/settings/subscription), so a completed payment landed
  // on a 404. Embedded Checkout still needs a `return_url` (Stripe navigates there once
  // the payment finishes, even though the card-entry form itself now renders in-page
  // instead of on checkout.stripe.com) — session_id lets the page confirm the real status
  // via GET /api/billing/checkout/session rather than trusting the query string alone.
  //
  // returnTo (optional): where an upsell elsewhere in the dashboard wants the user sent
  // back to once payment is confirmed (e.g. Domains' custom-domain upgrade prompt lands
  // back on Domains, not stranded on this settings page). Always routes through
  // /dashboard/settings/subscription first regardless — that's the one page with the
  // session_id-confirmation logic already built; it forwards on to returnTo itself once
  // it has confirmed the payment actually completed.
  const returnTo = (body as { returnTo?: unknown }).returnTo;
  const returnToSuffix = isSafeReturnTo(returnTo) ? `&returnTo=${encodeURIComponent(returnTo)}` : "";
  const returnUrl = `${appUrl}/dashboard/settings/subscription?session_id={CHECKOUT_SESSION_ID}${returnToSuffix}`;

  // Paystack sends the person back here if the popup can't be used (it appends ?reference=).
  const paystackCallbackUrl = `${appUrl}/dashboard/settings/subscription?paystack=1${returnToSuffix}`;

  try {
    if (body.kind === "subscription") {
      const plan: PaidPlanId = body.plan === "ULTRA" ? "PRO" : body.plan;
      const interval: BillingInterval = body.interval ?? "monthly";
      if (interval === "yearly" && !yearlyOffered(region, plan)) {
        return NextResponse.json({ error: `The ${PLAN_LABELS[plan]} plan is only available monthly. Please choose monthly billing.` }, { status: 400 });
      }

      if (usesPaystack) {
        // Local currency: Paystack plan billing. Changing plan starts the new subscription and
        // stops the old one once the payment goes through (lib/billing/paystackBilling.ts).
        if (user.subscriptionProvider === "PAYSTACK" && user.subscriptionStatus !== "CANCELED" && user.subscriptionId && storedPlan(user) === plan && user.subscriptionInterval === interval) {
          return NextResponse.json({ error: `You're already on the ${PLAN_LABELS[plan]} plan.` }, { status: 400 });
        }
        const checkout = await startPaystackPlanCheckout({ user, region, plan, interval, callbackUrl: paystackCallbackUrl });
        return NextResponse.json(checkout);
      }

      const priceId = await ensureStripePlanPrice(stripe!, region, plan, interval);
      const metadata = { ...stripePlanMetadata({ plexoUserId: session.user.id, plan, interval, region: region.id }), previous_plan: user.subscriptionPlan ?? "FREE" };
      // Already paying for a plan? Change that subscription in place (prorated) — a new
      // Checkout here would open a SECOND subscription and bill them for both every month.
      const changed = await changePlanInPlace(stripe!, customerId!, plan, priceId, metadata);
      if (changed) return NextResponse.json(changed);

      const checkoutSession = await stripe!.checkout.sessions.create({
        ui_mode: "embedded_page",
        mode: "subscription",
        customer: customerId!,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: { metadata },
        return_url: returnUrl,
      });
      return NextResponse.json({ provider: "STRIPE", clientSecret: checkoutSession.client_secret });
    }

    if (body.kind === "topup" && usesPaystack) {
      const checkout = await startPaystackTopupCheckout({ user, region, pack: body.pack, callbackUrl: paystackCallbackUrl });
      return NextResponse.json(checkout);
    }

    if (body.kind === "funnel_addon_slot") {
      const orgResolution = await ensureActiveOrganization(session.user.id);
      if (orgResolution.status === "needs-choice") {
        return NextResponse.json({ error: "Choose an active organization before buying a funnel slot." }, { status: 400 });
      }

      // Created PENDING_PAYMENT before checkout — same "pending row before payment"
      // discipline as app/api/v1/domains/purchase/route.ts, so an abandoned checkout just
      // leaves an inert row, never a charge with nothing to show for it.
      const slotId = randomUUID();
      await LmsFunnelAddonSlot.create({
        id: slotId,
        organizationId: orgResolution.organizationId,
        userId: session.user.id,
      }).go();

      try {
        const priceId = process.env.STRIPE_PRICE_LMS_ADDON_SLOT;
        if (!priceId) throw new Error("Funnel slots can't be bought right now. Please try again later.");
        const checkoutSession = await stripe!.checkout.sessions.create({
          ui_mode: "embedded_page",
          mode: "subscription",
          customer: customerId!,
          line_items: [{ price: priceId, quantity: 1 }],
          subscription_data: {
            metadata: {
              plexoUserId: session.user.id,
              kind: "lms_addon_slot",
              slotId,
              organizationId: orgResolution.organizationId,
            },
          },
          return_url: returnUrl,
        });
        return NextResponse.json({ provider: "STRIPE", clientSecret: checkoutSession.client_secret });
      } catch (err) {
        await LmsFunnelAddonSlot.patch({ organizationId: orgResolution.organizationId, id: slotId })
          .set({ status: "PAYMENT_FAILED", lastPaymentFailureReason: err instanceof Error ? err.message : "Could not start checkout." })
          .go();
        throw err;
      }
    }

    // Credits at the flat top-up rate (lib/billing/pricing.ts); the price is worked out here
    // from the price list, so there are no per-pack Stripe prices to keep in step. The webhook
    // grants from what was actually paid.
    const offer = topupOffer(region, body.pack);
    const checkoutSession = await stripe!.checkout.sessions.create({
      ui_mode: "embedded_page",
      mode: "payment",
      customer: customerId!,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: offer.currency.toLowerCase(),
            unit_amount: offer.amountMinor,
            product_data: { name: `${offer.credits.toLocaleString("en-US")} AI credits` },
          },
        },
      ],
      metadata: {
        plexoUserId: session.user.id,
        kind: "topup",
        pack: body.pack,
        credits: String(offer.credits),
        amountMinor: String(offer.amountMinor),
        region: region.id,
      },
      return_url: returnUrl,
      // stayInPage: the app editor's top-up panel finishes in place (onComplete) instead of
      // navigating away; Stripe still redirects for payment methods that need it.
      ...((body as { stayInPage?: unknown }).stayInPage === true ? { redirect_on_completion: "if_required" as const } : {}),
    });
    return NextResponse.json({ provider: "STRIPE", clientSecret: checkoutSession.client_secret });
  } catch (err) {
    if (err instanceof PlanChangeError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start checkout." },
      { status: 503 },
    );
  }
}
