import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { Template, LmsFunnel } from "@/lib/db/contentEntities";
import { CommerceSettings, CommerceProduct, CommerceOrder } from "@/lib/db/commerceEntities";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";
import { decryptPaystackKey, decryptStripeKey } from "@/lib/crypto";
import { initializePaystackTransaction } from "@/lib/paystack";
import { resolveCheckoutPaystackSecret } from "@/lib/commerce/paystack";
import { resolveCheckoutStripeSecret } from "@/lib/commerce/stripe";
import { createCommerceStripeCheckoutSession } from "@/lib/commerce/stripeClient";
import { createCommerceOrder, failCommerceOrder, OutOfStockError, InvalidDiscountError, SlotTakenError } from "@/lib/commerce/checkoutDynamo";

function generateOrderNumber(): string {
  return `ORD-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function generatePaystackReference(): string {
  return `plx_${randomBytes(12).toString("hex")}`;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * POST /api/public/lms/[templateId]/signup/checkout
 *
 * The PAID counterpart to .../signup/route.ts (FREE) — starts real payment for a funnel's
 * linked signup product instead of enrolling directly. Deliberately a narrower sibling of
 * app/api/public/commerce/checkout/route.ts rather than calling it: that route's own
 * validation *requires* scheduledStart for anything that isn't PHYSICAL (a SERVICE-booking
 * assumption baked into the route, not into createCommerceOrder itself), which would wrongly
 * demand a slot for a DIGITAL signup product. Every other step — provider resolution, order
 * creation, Stripe/Paystack initiation — is copied verbatim from that route, same functions,
 * same shapes, so this stays in lockstep with however Commerce's own checkout evolves.
 *
 * On successful payment, activation happens the same way a normal digital-product purchase
 * does — the Stripe/Paystack webhook calls handleOrderPaid -> deliverDigitalProducts, which
 * already detects a funnel's signupProductId and calls activateLmsEnrollmentFromOrder
 * (lib/lms/enrollment.ts) instead of the generic digital-delivery-token path. Nothing here
 * enrolls anyone directly — this route only ever gets as far as "payment started."
 */
export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;

  const allowed = await checkCommerceRateLimit(`lms:checkout:${templateId}:${clientIp(request)}`, 10);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts — please try again shortly." }, { status: 429 });
  }

  const [{ data: site }, { data: funnel }] = await Promise.all([
    Template.get({ id: templateId }).go(),
    LmsFunnel.get({ templateId }).go(),
  ]);
  if (!site || !funnel || !funnel.enabled) {
    return NextResponse.json({ error: "This funnel isn't available." }, { status: 404 });
  }
  if (funnel.signupMode !== "PAID" || !funnel.signupProductId) {
    return NextResponse.json({ error: "This funnel doesn't require payment to join." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  // Where the visitor's own browser should land after paying — an arbitrary external page
  // (the widget can be embedded anywhere, see public/lms-signup.js), not an app-internal
  // path, so this isn't the usual "root-relative only" returnTo check — only a scheme
  // check, to stop a javascript:/data: value from ever reaching Stripe/Paystack's own
  // redirect. Falls back to the Plexo-hosted learner page, which always exists.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const rawReturnUrl = typeof body.returnUrl === "string" ? body.returnUrl : "";
  const returnBase = /^https?:\/\//i.test(rawReturnUrl) ? rawReturnUrl : `${appUrl}/learn/${templateId}`;

  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (funnel.requireName && !name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  if (!settings || !settings.enabled) {
    return NextResponse.json({ error: "Payments aren't set up for this funnel yet." }, { status: 400 });
  }

  const { data: product } = await CommerceProduct.get({ templateId, id: funnel.signupProductId }).go();
  if (!product || !(product.active ?? true)) {
    return NextResponse.json({ error: "This funnel's signup product is no longer available." }, { status: 400 });
  }

  const isStripeFlow = settings.paymentProvider === "PLATFORM_STRIPE" || settings.paymentProvider === "BYO_STRIPE";
  const paystackKeys = isStripeFlow
    ? null
    : resolveCheckoutPaystackSecret({
        paymentProvider: settings.paymentProvider ?? "BYO_PAYSTACK",
        paystackMode: settings.paystackMode ?? "TEST",
        paystackTestPublicKey: settings.paystackTestPublicKey ?? null,
        paystackTestSecretKeyEncrypted: settings.paystackTestSecretKeyEncrypted ?? null,
        paystackLivePublicKey: settings.paystackLivePublicKey ?? null,
        paystackLiveSecretKeyEncrypted: settings.paystackLiveSecretKeyEncrypted ?? null,
      });
  const stripeKeys = isStripeFlow
    ? resolveCheckoutStripeSecret({
        paymentProvider: settings.paymentProvider ?? "BYO_PAYSTACK",
        stripeMode: settings.stripeMode ?? "TEST",
        stripeTestPublishableKey: settings.stripeTestPublishableKey ?? null,
        stripeTestSecretKeyEncrypted: settings.stripeTestSecretKeyEncrypted ?? null,
        stripeTestWebhookSecretEncrypted: settings.stripeTestWebhookSecretEncrypted ?? null,
        stripeLivePublishableKey: settings.stripeLivePublishableKey ?? null,
        stripeLiveSecretKeyEncrypted: settings.stripeLiveSecretKeyEncrypted ?? null,
        stripeLiveWebhookSecretEncrypted: settings.stripeLiveWebhookSecretEncrypted ?? null,
      })
    : null;
  if (!isStripeFlow && (!paystackKeys?.secretKeyEncrypted || !paystackKeys.publicKey)) {
    return NextResponse.json({ error: "Payments aren't set up for this funnel yet." }, { status: 400 });
  }
  if (isStripeFlow && !stripeKeys?.secretKeyEncrypted) {
    return NextResponse.json({ error: "Payments aren't set up for this funnel yet." }, { status: 400 });
  }

  const currency = settings.currency ?? "NGN";
  const amountMinor = product.priceMinor; // quantity is always 1 — a funnel signup is never a multi-quantity purchase

  if (amountMinor <= 0) {
    return NextResponse.json({ error: "This funnel's signup price isn't configured correctly." }, { status: 400 });
  }

  const orderNumber = generateOrderNumber();
  const paystackMode = isStripeFlow || paystackKeys?.isPlatform ? null : settings.paystackMode ?? "TEST";
  const paystackReference = isStripeFlow ? null : generatePaystackReference();

  let order;
  try {
    order = await createCommerceOrder({
      templateId,
      organizationId: site.organizationId,
      product,
      quantity: 1,
      orderNumber,
      paystackReference,
      customerEmail: email,
      customerName: name || null,
      customerPhone: phone || null,
      deliveryMethod: null,
      shippingAddress: { shippingCountry: null, shippingState: null, shippingAddressLine: null },
      discount: null,
      discountAmountMinor: 0,
      amountMinor,
      currency,
      paymentProvider: settings.paymentProvider ?? "BYO_PAYSTACK",
      paystackMode,
      scheduledStart: null,
      scheduledEnd: null,
    });
  } catch (err) {
    if (err instanceof OutOfStockError || err instanceof SlotTakenError || err instanceof InvalidDiscountError) {
      return NextResponse.json({ error: "Could not start checkout — please try again." }, { status: 409 });
    }
    throw err;
  }

  const separator = returnBase.includes("?") ? "&" : "?";
  const callbackUrl = `${returnBase}${separator}plexo_lms_signup_paid=1&order=${order.orderNumber}`;

  try {
    if (isStripeFlow) {
      const stripeSecretKey = stripeKeys!.isPlatform ? stripeKeys!.secretKeyEncrypted! : decryptStripeKey(stripeKeys!.secretKeyEncrypted!);
      const session = await createCommerceStripeCheckoutSession({
        secretKey: stripeSecretKey,
        orderId: order.id,
        templateId,
        amountMinor,
        currency,
        customerEmail: email,
        productName: product.name,
        returnUrl: callbackUrl,
      });
      await CommerceOrder.patch({ templateId: order.templateId, id: order.id }).set({ stripeCheckoutSessionId: session.id }).go();
      return NextResponse.json({
        orderNumber: order.orderNumber,
        checkout: { provider: "stripe", clientSecret: session.clientSecret, publishableKey: stripeKeys!.publishableKey },
      });
    }

    const secretKey = paystackKeys!.isPlatform ? paystackKeys!.secretKeyEncrypted! : decryptPaystackKey(paystackKeys!.secretKeyEncrypted!);
    const result = await initializePaystackTransaction({
      secretKey,
      email,
      amountMinor,
      currency,
      reference: order.paystackReference!,
      callbackUrl,
      metadata: { orderId: order.id, orderNumber: order.orderNumber, templateId },
    });
    await CommerceOrder.patch({ templateId: order.templateId, id: order.id }).set({ paystackAuthorizationUrl: result.authorizationUrl }).go();

    return NextResponse.json({
      orderNumber: order.orderNumber,
      reference: order.paystackReference,
      authorizationUrl: result.authorizationUrl,
    });
  } catch (err) {
    await failCommerceOrder(order, product, 1, null);
    const message = err instanceof Error ? err.message : "Unable to start payment. Please try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
