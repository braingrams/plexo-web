import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { EntityItem } from "electrodb";

import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { decryptPaystackKey, decryptStripeKey } from "@/lib/crypto";
import { initializePaystackTransaction } from "@/lib/paystack";
import { resolveCheckoutPaystackSecret } from "@/lib/commerce/paystack";
import { resolveCheckoutStripeSecret } from "@/lib/commerce/stripe";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";
import { readCartToken, findOpenCart, clearCartCookie } from "@/lib/commerce/cartDynamo";
import { createCommerceStripeCheckoutSession } from "@/lib/commerce/stripeClient";
import { createCommerceCartOrder, failCommerceCartOrder, OutOfStockError, InvalidDiscountError, CartAlreadyCheckedOutError } from "@/lib/commerce/checkoutDynamo";
import { resolveOrderDeliveryMethod, InvalidDeliveryMethodError } from "@/lib/commerce/delivery";
import { CommerceOrder, CommerceSettings, CommerceCartItem, CommerceProduct, CommerceDiscountCode } from "@/lib/db/commerceEntities";

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
 * Multi-item checkout from the visitor's cart — the checkout_flow block's "Pay" action.
 * Mirrors app/api/public/commerce/checkout/route.ts's atomic-guard/sentinel-error/rollback
 * shape exactly, just looped over every cart item inside the same transaction instead of
 * a single product.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  const siteResult = await resolveSite(hostname);
  if (siteResult.status !== "ok") {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  const { templateId, organization } = siteResult.published;
  const organizationId = organization.id;

  const allowed = await checkCommerceRateLimit(`commerce:checkout-cart:${templateId}:${clientIp(request)}`, 10);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  const cart = await findOpenCart(templateId, readCartToken(request));
  if (!cart) {
    return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { customerEmail, customerName, customerPhone, deliveryMethodId, shippingCountry, shippingState, shippingAddressLine, discountCode: rawDiscountCode } = body;

  if (typeof customerEmail !== "string" || !isValidEmail(customerEmail)) {
    return NextResponse.json({ error: "A valid customerEmail is required." }, { status: 400 });
  }

  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  if (!settings || !settings.enabled) {
    return NextResponse.json({ error: "Commerce is not enabled for this site." }, { status: 400 });
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
    return NextResponse.json({ error: "Commerce is not enabled for this site." }, { status: 400 });
  }
  if (isStripeFlow && !stripeKeys?.secretKeyEncrypted) {
    return NextResponse.json({ error: "Commerce is not enabled for this site." }, { status: 400 });
  }

  const { data: cartItemRows } = await CommerceCartItem.query.primary({ templateId, cartId: cart.id }).go();
  const productRows = await Promise.all(cartItemRows.map((i) => CommerceProduct.get({ templateId, id: i.productId }).go()));
  const activeItems = cartItemRows
    .map((i, idx) => ({ product: productRows[idx].data, quantity: i.quantity ?? 1 }))
    .filter((i): i is { product: EntityItem<typeof CommerceProduct>; quantity: number } => Boolean(i.product) && (i.product!.active ?? true));
  if (activeItems.length === 0) {
    return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
  }
  // Currency is a site-wide setting (Settings > General), not a per-product value —
  // reading it from settings instead of the first cart item's own `currency` attribute
  // also fixes what used to be a real bug: a cart mixing items would silently charge
  // everything at whichever product happened to be first.
  const currency = settings.currency ?? "NGN";

  const shippingAddress = {
    shippingCountry: typeof shippingCountry === "string" && shippingCountry ? shippingCountry : null,
    shippingState: typeof shippingState === "string" && shippingState ? shippingState : null,
    shippingAddressLine: typeof shippingAddressLine === "string" && shippingAddressLine ? shippingAddressLine : null,
  };

  // Re-validated server-side, never trusting the client-supplied id or its fee. Only
  // required when the cart actually has something to ship — an all-DIGITAL/SERVICE cart
  // skips delivery entirely.
  let resolvedDeliveryMethod: Awaited<ReturnType<typeof resolveOrderDeliveryMethod>> = null;
  if (activeItems.some((i) => i.product.kind === "PHYSICAL")) {
    try {
      resolvedDeliveryMethod = await resolveOrderDeliveryMethod(
        templateId,
        typeof deliveryMethodId === "string" ? deliveryMethodId : null,
        { country: shippingAddress.shippingCountry, state: shippingAddress.shippingState },
      );
    } catch (err) {
      if (err instanceof InvalidDeliveryMethodError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  // Prices are never trusted from the cart snapshot at this point either — re-read fresh
  // right before charging, same "server always re-derives the amount" rule the single-
  // product checkout follows.
  const subtotalMinor = activeItems.reduce((sum, item) => sum + item.product.priceMinor * item.quantity, 0);

  let discount: EntityItem<typeof CommerceDiscountCode> | null = null;
  const normalizedDiscountCode = typeof rawDiscountCode === "string" ? rawDiscountCode.trim().toUpperCase() : "";
  if (normalizedDiscountCode) {
    const { data: matches } = await CommerceDiscountCode.query.byCode({ templateId, code: normalizedDiscountCode }).go();
    discount = matches[0] ?? null;
    const invalid =
      !discount ||
      !(discount.active ?? true) ||
      (discount.expiresAt && new Date(discount.expiresAt).getTime() <= Date.now()) ||
      (discount.usageLimit != null && (discount.usedCount ?? 0) >= discount.usageLimit);
    if (invalid) {
      return NextResponse.json({ error: "That discount code isn't valid." }, { status: 400 });
    }
  }

  const discountAmountMinor = discount
    ? discount.type === "PERCENT"
      ? Math.round((subtotalMinor * discount.value) / 100)
      : Math.min(discount.value, subtotalMinor)
    : 0;
  const amountMinor = subtotalMinor + (resolvedDeliveryMethod?.feeMinor ?? 0) - discountAmountMinor;

  if (amountMinor <= 0) {
    return NextResponse.json({ error: "This discount would reduce the order to zero — pick a smaller code or a larger order." }, { status: 400 });
  }

  const orderNumber = generateOrderNumber();
  const paystackMode = isStripeFlow || paystackKeys?.isPlatform ? null : settings.paystackMode ?? "TEST";
  const paystackReference = isStripeFlow ? null : generatePaystackReference();

  let order;
  try {
    order = await createCommerceCartOrder({
      templateId,
      organizationId,
      cartId: cart.id,
      items: activeItems,
      orderNumber,
      paystackReference,
      customerEmail,
      customerName: typeof customerName === "string" ? customerName : null,
      customerPhone: typeof customerPhone === "string" ? customerPhone : null,
      deliveryMethod: resolvedDeliveryMethod,
      shippingAddress,
      discount,
      discountAmountMinor,
      amountMinor,
      currency,
      paymentProvider: settings.paymentProvider ?? "BYO_PAYSTACK",
      paystackMode,
    });
  } catch (err) {
    if (err instanceof OutOfStockError) {
      return NextResponse.json({ error: `"${err.productName}" just sold out — remove it from your cart to continue.` }, { status: 409 });
    }
    if (err instanceof InvalidDiscountError) {
      return NextResponse.json({ error: "That discount code isn't valid." }, { status: 400 });
    }
    if (err instanceof CartAlreadyCheckedOutError) {
      return NextResponse.json({ error: "This cart was already checked out." }, { status: 409 });
    }
    throw err;
  }

  const callbackUrl = `${request.nextUrl.origin}/order-confirmation?order=${order.orderNumber}&email=${encodeURIComponent(customerEmail)}`;

  try {
    if (isStripeFlow) {
      // stripeKeys is confirmed non-null above (isStripeFlow is true in this branch).
      const stripeSecretKey = stripeKeys!.isPlatform ? stripeKeys!.secretKeyEncrypted! : decryptStripeKey(stripeKeys!.secretKeyEncrypted!);
      const session = await createCommerceStripeCheckoutSession({
        secretKey: stripeSecretKey,
        orderId: order.id,
        templateId,
        amountMinor,
        currency,
        customerEmail,
        productName: activeItems.length === 1 ? activeItems[0].product.name : `${activeItems.length} items`,
        returnUrl: callbackUrl,
      });
      await CommerceOrder.patch({ templateId: order.templateId, id: order.id }).set({ stripeCheckoutSessionId: session.id }).go();
      // Card entry happens in-page (embedded Checkout) — no authorizationUrl to redirect
      // to; the storefront mounts Stripe.js against clientSecret/publishableKey instead.
      const response = NextResponse.json({
        orderNumber: order.orderNumber,
        checkout: { provider: "stripe", clientSecret: session.clientSecret, publishableKey: stripeKeys!.publishableKey },
      });
      clearCartCookie(response);
      return response;
    }

    const secretKey = paystackKeys!.isPlatform ? paystackKeys!.secretKeyEncrypted! : decryptPaystackKey(paystackKeys!.secretKeyEncrypted!);
    const result = await initializePaystackTransaction({
      secretKey,
      email: customerEmail,
      amountMinor,
      currency,
      reference: order.paystackReference!,
      // email travels alongside order — the order-confirmation page has no session/account
      // to identify the visitor with, and the strict order-lookup endpoint deliberately
      // requires orderNumber+email together (never orderNumber alone) to prevent a stranger
      // from browsing someone else's order by guessing a short code. The visitor just typed
      // this email into the checkout form seconds ago, so this is a same-session redirect,
      // not a new disclosure.
      callbackUrl,
      metadata: { orderId: order.id, orderNumber: order.orderNumber, templateId },
    });
    await CommerceOrder.patch({ templateId: order.templateId, id: order.id }).set({ paystackAuthorizationUrl: result.authorizationUrl }).go();

    const response = NextResponse.json({ orderNumber: order.orderNumber, reference: order.paystackReference, authorizationUrl: result.authorizationUrl });
    clearCartCookie(response);
    return response;
  } catch (err) {
    // Reopens the cart so the visitor doesn't lose their items over a payment-provider hiccup.
    // Surface the real provider error (e.g. a currency the connected account isn't
    // provisioned for) instead of a generic message — same reasoning as the single-product
    // checkout route.
    await failCommerceCartOrder(order, activeItems, discount);
    const message = err instanceof Error ? err.message : "Unable to start payment. Please try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
