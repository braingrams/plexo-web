import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { EntityItem } from "electrodb";

import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { decryptPaystackKey, decryptStripeKey } from "@/lib/crypto";
import { initializePaystackTransaction } from "@/lib/paystack";
import { resolveCheckoutPaystackSecret } from "@/lib/commerce/paystack";
import { resolveCheckoutStripeSecret } from "@/lib/commerce/stripe";
import { isSlotAvailable } from "@/lib/commerce/availability";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";
import { createCommerceStripeCheckoutSession } from "@/lib/commerce/stripeClient";
import { createCommerceOrder, failCommerceOrder, OutOfStockError, SlotTakenError, InvalidDiscountError, VariantUnavailableError } from "@/lib/commerce/checkoutDynamo";
import { lineName, resolvePurchasable } from "@/lib/commerce/variants";
import { resolveOrderDeliveryMethod, InvalidDeliveryMethodError, pickupLocationFor } from "@/lib/commerce/delivery";
import { readCheckoutFields, resolveCheckoutFieldAnswers, CheckoutFieldsError } from "@/lib/commerce/checkoutFields";
import { chooseCheckoutPaymentMethod } from "@/lib/commerce/checkoutPayment";
import { isBankTransferReady, generateBankTransferToken, notifyBankTransferPlaced, BANK_TRANSFER_HOLD_MS } from "@/lib/commerce/bankTransfer";
import { CommerceOrder, CommerceSettings, CommerceProduct, CommerceDiscountCode, CommerceAvailabilityRule, CommerceAvailabilityException, CommerceBooking } from "@/lib/db/commerceEntities";

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
 * Starts a Commerce purchase or service booking: creates a PENDING order (+ booking hold,
 * for services) and hands back a Paystack hosted-checkout URL to redirect the visitor to.
 * Unauthenticated by necessity (any site visitor hits this) — see the Commerce plan's
 * "production hardening" notes.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  const siteResult = await resolveSite(hostname);
  if (siteResult.status !== "ok") {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  const { templateId, organization } = siteResult.published;
  const organizationId = organization.id;

  const allowed = await checkCommerceRateLimit(`commerce:checkout:${templateId}:${clientIp(request)}`, 10);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const {
    productId,
    variantId: rawVariantId,
    quantity: rawQuantity,
    scheduledStart: rawScheduledStart,
    customerEmail,
    customerName,
    customerPhone,
    deliveryMethodId,
    shippingCountry,
    shippingState,
    shippingAddressLine,
    discountCode: rawDiscountCode,
    paymentMethod: requestedPaymentMethod,
    customFields: rawCustomFields,
  } = body;

  if (typeof productId !== "string" || !productId) {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }
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
  const gatewayReady = isStripeFlow ? Boolean(stripeKeys?.secretKeyEncrypted) : Boolean(paystackKeys?.secretKeyEncrypted && paystackKeys.publicKey);
  const paymentChoice = chooseCheckoutPaymentMethod(requestedPaymentMethod, gatewayReady, isBankTransferReady(settings));
  if ("error" in paymentChoice) {
    return NextResponse.json({ error: paymentChoice.error }, { status: 400 });
  }
  const isBankTransfer = paymentChoice.method === "BANK_TRANSFER";

  // Currency is a site-wide setting (Settings > General), not a per-product value — a
  // product's own `currency` attribute is a vestigial per-record default from before that
  // decision and is never read here anymore.
  const currency = settings.currency ?? "NGN";

  // Never trust a client-supplied price — the only thing read from the request body that
  // ends up in amountMinor is which product and how many, resolved against this row.
  const { data: product } = await CommerceProduct.get({ templateId, id: productId }).go();
  if (!product || !(product.active ?? true)) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }

  // A product with options (Size, Colour…) is bought as one specific variant.
  const variantId = typeof rawVariantId === "string" && rawVariantId ? rawVariantId : null;
  const purchase = resolvePurchasable(product, variantId);
  if (!purchase.ok) return NextResponse.json({ error: purchase.error }, { status: 400 });

  let quantity = 1;
  let scheduledStart: Date | null = null;
  let scheduledEnd: Date | null = null;

  if (product.kind === "PHYSICAL") {
    quantity = typeof rawQuantity === "number" && Number.isInteger(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1;
  } else {
    if (typeof rawScheduledStart !== "string") {
      return NextResponse.json({ error: "scheduledStart is required to book this service." }, { status: 400 });
    }
    scheduledStart = new Date(rawScheduledStart);
    if (Number.isNaN(scheduledStart.getTime()) || scheduledStart.getTime() <= Date.now()) {
      return NextResponse.json({ error: "scheduledStart must be a valid future date." }, { status: 400 });
    }
    scheduledEnd = new Date(scheduledStart.getTime() + (product.durationMinutes ?? 60) * 60_000);

    // Recompute availability server-side — never trust a client-supplied slot. This is
    // defense in depth alongside the DB unique-constraint race guard below: it rejects a
    // slot that was never open in the first place (outside business hours, a closed date),
    // even when nobody else is racing for it.
    const now = new Date();
    const [{ data: ruleRows }, { data: exceptionRows }, { data: orgBookings }] = await Promise.all([
      CommerceAvailabilityRule.query.byProduct({ productId: product.id }).go(),
      CommerceAvailabilityException.query.byProduct({ productId: product.id }).go(),
      CommerceBooking.query.byOrg({ organizationId }).go({ pages: "all" }),
    ]);
    const rules = ruleRows.map((r) => ({ dayOfWeek: r.dayOfWeek, startMinute: r.startMinute, endMinute: r.endMinute, timezone: r.timezone ?? "Africa/Lagos" }));
    const exceptions = exceptionRows.filter((e) => e.closed ?? true).map((e) => ({ date: new Date(e.date), closed: true as const }));
    const existingBookings = orgBookings
      .filter(
        (b) =>
          b.templateId === templateId &&
          b.productId === product.id &&
          (b.status === "CONFIRMED" || (b.status === "PENDING_PAYMENT" && b.holdExpiresAt && new Date(b.holdExpiresAt).getTime() > now.getTime())),
      )
      .map((b) => ({ scheduledStart: new Date(b.scheduledStart), scheduledEnd: new Date(b.scheduledEnd) }));

    if (!isSlotAvailable({ scheduledStart, scheduledEnd, rules, exceptions, existingBookings })) {
      return NextResponse.json({ error: "That time isn't available for booking." }, { status: 400 });
    }
  }

  const shippingAddress = {
    shippingCountry: typeof shippingCountry === "string" && shippingCountry ? shippingCountry : null,
    shippingState: typeof shippingState === "string" && shippingState ? shippingState : null,
    shippingAddressLine: typeof shippingAddressLine === "string" && shippingAddressLine ? shippingAddressLine : null,
  };

  // Re-validated server-side, never trusting the client-supplied id or its fee — a
  // DIGITAL/SERVICE product never resolves a method at all.
  let resolvedDeliveryMethod: Awaited<ReturnType<typeof resolveOrderDeliveryMethod>> = null;
  if (product.kind === "PHYSICAL") {
    if (typeof deliveryMethodId !== "string" || !deliveryMethodId) {
      return NextResponse.json({ error: "Please choose how you'd like to get your order — delivery or pickup." }, { status: 400 });
    }
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

  // After delivery resolution on purpose — see the cart route: country-limited questions
  // follow where the order actually ships (none for pickup, bookings or digital products).
  const deliveryCountry = resolvedDeliveryMethod?.type === "COURIER" ? shippingAddress.shippingCountry : null;
  let customFieldAnswers;
  try {
    customFieldAnswers = resolveCheckoutFieldAnswers(readCheckoutFields(settings.checkoutFields), rawCustomFields, deliveryCountry);
  } catch (err) {
    if (err instanceof CheckoutFieldsError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  const subtotalMinor = purchase.unitPriceMinor * quantity;

  // Fast, non-authoritative pre-check — a clean error for an obviously-bad code before
  // ever attempting the transaction. The atomic claim inside createCommerceOrder is what
  // actually enforces usageLimit under concurrency; this is just early rejection.
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
  // Platform Paystack has no per-site test/live split (a single ops-controlled key, see
  // resolveCheckoutPaystackSecret) — paystackMode only means anything for BYO_PAYSTACK.
  // Stripe orders use neither field (see stripeCheckoutSessionId instead, set after this
  // transaction commits).
  const paystackMode = isBankTransfer || isStripeFlow || paystackKeys?.isPlatform ? null : settings.paystackMode ?? "TEST";
  const paystackReference = isBankTransfer || isStripeFlow ? null : generatePaystackReference();

  let order;
  try {
    order = await createCommerceOrder({
      templateId,
      organizationId,
      product,
      variantId,
      quantity,
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
      scheduledStart,
      scheduledEnd,
      extras: {
        paymentMethod: paymentChoice.method,
        bankTransferConfirmToken: isBankTransfer ? generateBankTransferToken() : null,
        pickupLocationSnapshot: pickupLocationFor(resolvedDeliveryMethod, settings),
        customFields: customFieldAnswers,
      },
      holdMs: isBankTransfer ? BANK_TRANSFER_HOLD_MS : undefined,
    });
  } catch (err) {
    if (err instanceof SlotTakenError) {
      return NextResponse.json({ error: "That time slot was just booked by someone else. Please pick another." }, { status: 409 });
    }
    if (err instanceof OutOfStockError) {
      const left = Math.max(0, purchase.stockQuantity ?? 0);
      return NextResponse.json({ error: left > 0 ? `Only ${left} left in stock.` : `${lineName(product.name, purchase.label)} is out of stock.` }, { status: 409 });
    }
    if (err instanceof VariantUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof InvalidDiscountError) {
      return NextResponse.json({ error: "That discount code isn't valid." }, { status: 400 });
    }
    throw err;
  }

  const callbackUrl = `${request.nextUrl.origin}/order-confirmation?order=${order.orderNumber}&email=${encodeURIComponent(customerEmail)}`;

  // Bank transfer: the order (and any booking slot) is held until the owner confirms the
  // money arrived — see lib/commerce/bankTransfer.ts.
  if (isBankTransfer) {
    await notifyBankTransferPlaced(order, settings).catch((err) => console.error("Commerce: bank transfer notify failed", err));
    return NextResponse.json({ orderNumber: order.orderNumber, paymentMethod: "BANK_TRANSFER", redirectUrl: callbackUrl });
  }

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
        productName: lineName(product.name, purchase.label),
        returnUrl: callbackUrl,
      });
      await CommerceOrder.patch({ templateId: order.templateId, id: order.id }).set({ stripeCheckoutSessionId: session.id }).go();
      // Card entry happens in-page (embedded Checkout) — no authorizationUrl to redirect
      // to; the storefront mounts Stripe.js against clientSecret/publishableKey instead.
      return NextResponse.json({
        orderNumber: order.orderNumber,
        checkout: { provider: "stripe", clientSecret: session.clientSecret, publishableKey: stripeKeys!.publishableKey },
      });
    }

    // paystackKeys is confirmed non-null above (isStripeFlow is false in this branch).
    const secretKey = paystackKeys!.isPlatform ? paystackKeys!.secretKeyEncrypted! : decryptPaystackKey(paystackKeys!.secretKeyEncrypted!);
    const result = await initializePaystackTransaction({
      secretKey,
      email: customerEmail,
      amountMinor,
      currency,
      // Same reasoning as the cart checkout route: email travels alongside order because
      // the strict order-lookup endpoint requires both together, and /order-confirmation
      // (not "/") is the default landing spot for a site with a dedicated confirmation
      // page — see the Commerce plan's runtime section.
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
    // Paystack/Stripe itself rejected the initialize call — mark the order FAILED rather
    // than leaving a PENDING order with no way to ever get paid, and release anything it held.
    // Surface the real provider error (e.g. a currency the connected account isn't
    // provisioned for) instead of a generic message — a silent rejection here is exactly
    // how a currency mismatch would otherwise go unnoticed.
    await failCommerceOrder(order, product, quantity, discount, variantId);
    const message = err instanceof Error ? err.message : "Unable to start payment. Please try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
