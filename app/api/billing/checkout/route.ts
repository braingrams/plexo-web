import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { PLAN_PRICE_ENV, TOPUP_PACKS, resolvePriceId } from "@/lib/credits/catalog";
import { getStripe } from "@/lib/stripe";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { User } from "@/lib/db/coreEntities";
import { LmsFunnelAddonSlot } from "@/lib/db/contentEntities";

type CheckoutRequest =
  | { kind: "subscription"; plan: "PRO" | "ULTRA" }
  | { kind: "topup"; pack: "SMALL" | "MEDIUM" | "LARGE" }
  | { kind: "funnel_addon_slot" };

function isValidBody(value: unknown): value is CheckoutRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  if (body.kind === "subscription") return body.plan === "PRO" || body.plan === "ULTRA";
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

  const stripe = getStripe();
  const { data: user } = await User.get({ id: session.user.id }).go();
  if (!user) throw new Error(`Session user ${session.user.id} has no matching User record`);

  let customerId = user.stripeCustomerId;
  if (!customerId) {
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

  try {
    if (body.kind === "subscription") {
      const priceId = resolvePriceId(PLAN_PRICE_ENV[body.plan]);
      const checkoutSession = await stripe.checkout.sessions.create({
        ui_mode: "embedded_page",
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: { metadata: { plexoUserId: session.user.id, plan: body.plan } },
        return_url: returnUrl,
      });
      return NextResponse.json({ clientSecret: checkoutSession.client_secret });
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
        const priceId = resolvePriceId("STRIPE_PRICE_LMS_ADDON_SLOT");
        const checkoutSession = await stripe.checkout.sessions.create({
          ui_mode: "embedded_page",
          mode: "subscription",
          customer: customerId,
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
        return NextResponse.json({ clientSecret: checkoutSession.client_secret });
      } catch (err) {
        await LmsFunnelAddonSlot.patch({ organizationId: orgResolution.organizationId, id: slotId })
          .set({ status: "PAYMENT_FAILED", lastPaymentFailureReason: err instanceof Error ? err.message : "Could not start checkout." })
          .go();
        throw err;
      }
    }

    const pack = TOPUP_PACKS[body.pack];
    const priceId = resolvePriceId(pack.priceEnv);
    const checkoutSession = await stripe.checkout.sessions.create({
      ui_mode: "embedded_page",
      mode: "payment",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        plexoUserId: session.user.id,
        kind: "topup",
        pack: body.pack,
        credits: String(pack.credits),
      },
      return_url: returnUrl,
    });
    return NextResponse.json({ clientSecret: checkoutSession.client_secret });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start checkout." },
      { status: 503 },
    );
  }
}
