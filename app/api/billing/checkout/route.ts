import { NextRequest, NextResponse } from "next/server";

import { PLAN_PRICE_ENV, TOPUP_PACKS, resolvePriceId } from "@/lib/credits/catalog";
import { getStripe } from "@/lib/stripe";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

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
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as unknown;
  if (!isValidBody(body)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const stripe = getStripe();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { email: true, stripeCustomerId: true },
  });

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { plexoUserId: session.user.id },
    });
    customerId = customer.id;
    await prisma.user.update({ where: { id: session.user.id }, data: { stripeCustomerId: customerId } });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const successUrl = `${appUrl}/dashboard/settings?billing=success`;
  const cancelUrl = `${appUrl}/dashboard/settings?billing=cancelled`;

  try {
    if (body.kind === "subscription") {
      const priceId = resolvePriceId(PLAN_PRICE_ENV[body.plan]);
      const checkoutSession = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: { metadata: { plexoUserId: session.user.id, plan: body.plan } },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      return NextResponse.json({ url: checkoutSession.url });
    }

    const pack = TOPUP_PACKS[body.pack];
    const priceId = resolvePriceId(pack.priceEnv);
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        plexoUserId: session.user.id,
        kind: "topup",
        pack: body.pack,
        credits: String(pack.credits),
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    return NextResponse.json({ url: checkoutSession.url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start checkout." },
      { status: 503 },
    );
  }
}
