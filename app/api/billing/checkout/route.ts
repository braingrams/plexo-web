import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { ensureStripePlanPrice } from "@/lib/billing/stripePrices";
import { loadPriceBook } from "@/lib/billing/priceBook";
import { topupOffer } from "@/lib/credits/topupOffer";
import { billingRegionFor, regionLockFields } from "@/lib/billing/region";
import { stripePlanMetadata } from "@/lib/billing/stripePlans";
import { startPaystackPlanCheckout, startPaystackTopupCheckout } from "@/lib/billing/paystackBilling";
import { PLAN_LABELS, type PaidPlanId, PLAN, RETIRED_PLAN } from "@/lib/plan/plans";
import { storedPlan } from "@/lib/plan/entitlement";
import { creditsForTopupAmount, formatMoney, maxTopupAmount, minTopupAmount, minorUnits, planPrice, yearlyOffered, type BillingInterval } from "@/lib/billing/pricing";
import { getStripe } from "@/lib/stripe";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { User } from "@/lib/db/coreEntities";
import { LmsFunnelAddonSlot } from "@/lib/db/contentEntities";
import { PlanChangeError, changePlanInPlace } from "@/lib/billing/planChange";
import { hasRecurringPlan } from "@/lib/billing/oneTime";

type CheckoutRequest =
  | { kind: "subscription"; plan: PaidPlanId | typeof RETIRED_PLAN.ULTRA; interval?: BillingInterval; oneTime?: boolean }
  | { kind: "topup"; pack?: "SMALL" | "MEDIUM" | "LARGE"; customAmount?: number }
  | { kind: "funnel_addon_slot" };

function isValidBody(value: unknown): value is CheckoutRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  if (body.kind === "subscription") {
    if (body.interval !== undefined && body.interval !== "monthly" && body.interval !== "yearly") return false;
    if (body.oneTime !== undefined && typeof body.oneTime !== "boolean") return false;
    // ULTRA: a page loaded before the plan rename (it means today's Pro).
    return body.plan === PLAN.STARTER || body.plan === PLAN.PRO || body.plan === PLAN.ENTERPRISE || body.plan === RETIRED_PLAN.ULTRA;
  }
  if (body.kind === "topup") {
    if (body.pack === "SMALL" || body.pack === "MEDIUM" || body.pack === "LARGE") return true;
    if (typeof body.customAmount === "number" && Number.isFinite(body.customAmount) && body.customAmount > 0) return true;
    return false;
  }
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
      const plan: PaidPlanId = body.plan === RETIRED_PLAN.ULTRA ? PLAN.PRO : body.plan;
      const interval: BillingInterval = body.interval ?? "monthly";
      if (interval === "yearly" && !yearlyOffered(region, plan)) {
        return NextResponse.json({ error: `The ${PLAN_LABELS[plan]} plan is only available monthly. Please choose monthly billing.` }, { status: 400 });
      }

      const oneTime = body.oneTime === true;
      if (oneTime && !usesPaystack) {
        return NextResponse.json({ error: "Paying once is available when you pay in your local currency. You can subscribe instead." }, { status: 400 });
      }
      if (oneTime && hasRecurringPlan(user)) {
        return NextResponse.json({ error: "Your plan renews by itself right now. Cancel it first (it keeps working until the end of what you've paid for), and then you can pay once instead." }, { status: 400 });
      }

      if (usesPaystack) {
        // Local currency: Paystack plan billing. Changing plan starts the new subscription and
        // stops the old one once the payment goes through (lib/billing/paystackBilling.ts).
        if (!oneTime && user.subscriptionProvider === "PAYSTACK" && user.subscriptionStatus !== "CANCELED" && user.subscriptionId && storedPlan(user) === plan && user.subscriptionInterval === interval) {
          return NextResponse.json({ error: `You're already on the ${PLAN_LABELS[plan]} plan.` }, { status: 400 });
        }
        const checkout = await startPaystackPlanCheckout({ user, region, plan, interval, callbackUrl: paystackCallbackUrl, oneTime });
        return NextResponse.json(checkout);
      }

      const priceId = await ensureStripePlanPrice(stripe!, region, plan, interval);
      const metadata = { ...stripePlanMetadata({ plexoUserId: session.user.id, plan, interval, region: region.id }), previous_plan: user.subscriptionPlan ?? PLAN.FREE };
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
      // The price this form shows, in its currency (Enterprise is a starting point, so it gets no value).
      const shown = plan === PLAN.ENTERPRISE ? undefined : interval === "yearly" ? planPrice(region, plan, "yearly") ?? undefined : region.monthly[plan];
      return NextResponse.json({
        provider: "STRIPE",
        clientSecret: checkoutSession.client_secret,
        analytics: {
          checkoutType: "subscription",
          currency: region.currency,
          ...(shown !== undefined ? { value: shown } : {}),
          item: { item_id: `${plan.toLowerCase()}_${interval}`, item_name: PLAN_LABELS[plan], item_category: "subscription", item_variant: interval, ...(shown !== undefined ? { price: shown } : {}), quantity: 1 },
        },
      });
    }

    if (body.kind === "topup") {
      let credits: number;
      let amountMinor: number;
      let packLabel: string;

      if (body.customAmount !== undefined) {
        const min = minTopupAmount(region.currency);
        if (body.customAmount < min) {
          return NextResponse.json({ error: `The minimum top-up amount is ${formatMoney(min, region.currency)}.` }, { status: 400 });
        }
        const max = maxTopupAmount(region.currency);
        if (body.customAmount > max) {
          return NextResponse.json({ error: `The most you can top up at once is ${formatMoney(max, region.currency)}. For more, top up a few times or contact us.` }, { status: 400 });
        }
        const calculatedCredits = creditsForTopupAmount(body.customAmount, region.currency, region);
        if (!calculatedCredits || calculatedCredits <= 0) {
          return NextResponse.json({ error: "Invalid top-up amount." }, { status: 400 });
        }
        credits = calculatedCredits;
        amountMinor = Math.round(body.customAmount * minorUnits(region.currency));
        packLabel = "custom";
      } else if (body.pack) {
        const offer = topupOffer(region, body.pack);
        credits = offer.credits;
        amountMinor = offer.amountMinor;
        packLabel = body.pack;
      } else {
        return NextResponse.json({ error: "Invalid top-up request." }, { status: 400 });
      }

      if (usesPaystack) {
        const checkout = await startPaystackTopupCheckout({
          user,
          region,
          pack: body.pack,
          customAmount: body.customAmount,
          credits,
          amountMinor,
          callbackUrl: paystackCallbackUrl,
        });
        return NextResponse.json(checkout);
      }

      const checkoutSession = await stripe!.checkout.sessions.create({
        ui_mode: "embedded_page",
        mode: "payment",
        customer: customerId!,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: region.currency.toLowerCase(),
              unit_amount: amountMinor,
              product_data: { name: `${credits.toLocaleString("en-US")} credits` },
            },
          },
        ],
        metadata: {
          plexoUserId: session.user.id,
          kind: "topup",
          pack: packLabel,
          credits: String(credits),
          amountMinor: String(amountMinor),
          region: region.id,
          ...(body.customAmount ? { customAmount: String(body.customAmount) } : {}),
        },
        return_url: returnUrl,
        ...((body as { stayInPage?: unknown }).stayInPage === true ? { redirect_on_completion: "if_required" as const } : {}),
      });
      const packValue = amountMinor / minorUnits(region.currency);
      return NextResponse.json({
        provider: "STRIPE",
        clientSecret: checkoutSession.client_secret,
        analytics: {
          checkoutType: "credits",
          currency: region.currency,
          value: packValue,
          item: { item_id: `credits_${credits}`, item_name: `${credits.toLocaleString("en-US")} credits`, item_category: "credits", item_variant: "one_time", price: packValue, quantity: 1 },
        },
      });
    }

    if (body.kind === "funnel_addon_slot") {
      const orgResolution = await ensureActiveOrganization(session.user.id);
      if (orgResolution.status === "needs-choice") {
        return NextResponse.json({ error: "Choose an active organization before buying a funnel slot." }, { status: 400 });
      }
      if (orgResolution.role === "guest") {
        return NextResponse.json({ error: "Only the workspace owner or an admin can buy this." }, { status: 403 });
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
        // The funnel slot's price comes from Stripe, so the event shows the same amount the form does.
        const slotPrice = await stripe!.prices.retrieve(priceId);
        const slotCurrency = (slotPrice.currency ?? "usd").toUpperCase();
        const slotValue = slotPrice.unit_amount != null ? slotPrice.unit_amount / minorUnits(slotCurrency) : undefined;
        return NextResponse.json({
          provider: "STRIPE",
          clientSecret: checkoutSession.client_secret,
          analytics: {
            checkoutType: "funnel_slot",
            currency: slotCurrency,
            ...(slotValue !== undefined ? { value: slotValue } : {}),
            item: { item_id: "funnel_slot", item_name: "Funnel slot", item_category: "addon", item_variant: "monthly", ...(slotValue !== undefined ? { price: slotValue } : {}), quantity: 1 },
          },
        });
      } catch (err) {
        await LmsFunnelAddonSlot.patch({ organizationId: orgResolution.organizationId, id: slotId })
          .set({ status: "PAYMENT_FAILED", lastPaymentFailureReason: err instanceof Error ? err.message : "Could not start checkout." })
          .go();
        throw err;
      }
    }
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  } catch (err) {
    if (err instanceof PlanChangeError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start checkout." },
      { status: 503 },
    );
  }
}
