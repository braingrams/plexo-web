import { NextRequest, NextResponse } from "next/server";

import { PLAN_PRICE_ENV, TOPUP_PACKS, resolvePriceId } from "@/lib/credits/catalog";
import { getStripe } from "@/lib/stripe";
import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";

type CheckoutRequest =
  | { kind: "subscription"; plan: "PRO" | "ULTRA" }
  | { kind: "topup"; pack: "SMALL" | "MEDIUM" | "LARGE" };

function isValidBody(value: unknown): value is CheckoutRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  if (body.kind === "subscription") return body.plan === "PRO" || body.plan === "ULTRA";
  if (body.kind === "topup") return body.pack === "SMALL" || body.pack === "MEDIUM" || body.pack === "LARGE";
  return false;
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
  const returnUrl = `${appUrl}/dashboard/settings/subscription?session_id={CHECKOUT_SESSION_ID}`;

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
