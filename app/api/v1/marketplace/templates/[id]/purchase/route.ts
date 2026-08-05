import { NextRequest, NextResponse } from "next/server";

import { getStripe } from "@/lib/stripe";
import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";

/**
 * POST /api/v1/marketplace/templates/:id/purchase
 * Free templates are granted a TemplatePurchase row immediately (priceCentsPaid 0) —
 * paid ones start a Stripe Checkout session with an inline ad-hoc price (unit_amount
 * from the template's own priceCents), since marketplace prices are per-template, not
 * one of a small fixed catalog like the subscription/top-up checkout in
 * app/api/billing/checkout. The webhook (app/api/webhooks/stripe) creates the
 * TemplatePurchase row on checkout.session.completed, same as topup credits do.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const template = await prisma.template.findUnique({
    where: { id },
    select: { id: true, name: true, marketplaceStatus: true, priceCents: true, userId: true },
  });
  if (!template || template.marketplaceStatus !== "PUBLISHED") {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const existing = await prisma.templatePurchase.findUnique({
    where: { userId_templateId: { userId: resolved.userId, templateId: id } },
  });
  if (existing) {
    return NextResponse.json({ success: true, alreadyOwned: true });
  }

  const priceCents = template.priceCents ?? 0;
  if (priceCents <= 0) {
    await prisma.templatePurchase.create({
      data: { userId: resolved.userId, templateId: id, priceCentsPaid: 0 },
    });
    return NextResponse.json({ success: true, free: true });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: resolved.userId },
    select: { email: true, stripeCustomerId: true },
  });

  const stripe = getStripe();
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, metadata: { plexoUserId: resolved.userId } });
    customerId = customer.id;
    await prisma.user.update({ where: { id: resolved.userId }, data: { stripeCustomerId: customerId } });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `Plexo template: ${template.name}` },
            unit_amount: priceCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        plexoUserId: resolved.userId,
        kind: "template_purchase",
        templateId: id,
        priceCents: String(priceCents),
        // Consumed by the webhook to credit the seller's marketplace balance — harmless to
        // always include, even for admin-curated (system-account-owned) listings, since the
        // webhook skips crediting when this resolves to the marketplace system owner.
        sellerUserId: template.userId,
      },
      success_url: `${appUrl}/marketplace/${id}?purchase=success`,
      cancel_url: `${appUrl}/marketplace/${id}?purchase=cancelled`,
    });
    return NextResponse.json({ url: checkoutSession.url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start checkout." },
      { status: 503 },
    );
  }
}
