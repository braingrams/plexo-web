import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { Prisma, type CommerceOrder } from "@prisma/client";

import { prisma } from "@/server/prisma";
import { resolveSite } from "@/lib/pub/resolveSite";
import { decryptPaystackKey } from "@/lib/crypto";
import { initializePaystackTransaction } from "@/lib/paystack";
import { resolveCheckoutPaystackSecret } from "@/lib/commerce/paystack";
import { isSlotAvailable } from "@/lib/commerce/availability";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimit";
import { createCommerceStripeCheckoutSession } from "@/lib/commerce/stripeClient";

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
  const hostname = (request.headers.get("host") ?? "").split(":")[0];
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

  const { productId, quantity: rawQuantity, scheduledStart: rawScheduledStart, customerEmail, customerName, customerPhone, deliveryMethod, discountCode: rawDiscountCode } = body;

  if (typeof productId !== "string" || !productId) {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }
  if (typeof customerEmail !== "string" || !isValidEmail(customerEmail)) {
    return NextResponse.json({ error: "A valid customerEmail is required." }, { status: 400 });
  }

  const settings = await prisma.commerceSettings.findUnique({ where: { templateId } });
  if (!settings || !settings.enabled) {
    return NextResponse.json({ error: "Commerce is not enabled for this site." }, { status: 400 });
  }
  const isStripeFlow = settings.paymentProvider === "PLATFORM_STRIPE";
  const paystackKeys = isStripeFlow ? null : resolveCheckoutPaystackSecret(settings);
  if (!isStripeFlow && (!paystackKeys?.secretKeyEncrypted || !paystackKeys.publicKey)) {
    return NextResponse.json({ error: "Commerce is not enabled for this site." }, { status: 400 });
  }

  // Never trust a client-supplied price — the only thing read from the request body that
  // ends up in amountMinor is which product and how many, resolved against this row.
  const product = await prisma.commerceProduct.findFirst({
    where: { id: productId, templateId, active: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }

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
    const [rules, exceptions, existingBookings] = await Promise.all([
      prisma.commerceAvailabilityRule.findMany({
        where: { productId: product.id },
        select: { dayOfWeek: true, startMinute: true, endMinute: true, timezone: true },
      }),
      prisma.commerceAvailabilityException.findMany({
        where: { productId: product.id, closed: true },
        select: { date: true, closed: true },
      }),
      prisma.commerceBooking.findMany({
        where: {
          productId: product.id,
          OR: [{ status: "CONFIRMED" }, { status: "PENDING_PAYMENT", holdExpiresAt: { gt: new Date() } }],
        },
        select: { scheduledStart: true, scheduledEnd: true },
      }),
    ]);

    if (!isSlotAvailable({ scheduledStart, scheduledEnd, rules, exceptions, existingBookings })) {
      return NextResponse.json({ error: "That time isn't available for booking." }, { status: 400 });
    }
  }

  const deliveryMethodValue =
    product.kind === "PHYSICAL" && (deliveryMethod === "PICKUP" || deliveryMethod === "COURIER") ? deliveryMethod : null;

  const subtotalMinor = product.priceMinor * quantity;

  // Fast, non-authoritative pre-check — a clean error for an obviously-bad code before
  // ever opening a transaction. The atomic claim inside the transaction below is what
  // actually enforces usageLimit under concurrency; this is just early rejection.
  let discount: Awaited<ReturnType<typeof prisma.commerceDiscountCode.findUnique>> = null;
  const normalizedDiscountCode = typeof rawDiscountCode === "string" ? rawDiscountCode.trim().toUpperCase() : "";
  if (normalizedDiscountCode) {
    discount = await prisma.commerceDiscountCode.findUnique({ where: { templateId_code: { templateId, code: normalizedDiscountCode } } });
    const invalid =
      !discount ||
      !discount.active ||
      (discount.expiresAt && discount.expiresAt.getTime() <= Date.now()) ||
      (discount.usageLimit !== null && discount.usedCount >= discount.usageLimit);
    if (invalid) {
      return NextResponse.json({ error: "That discount code isn't valid." }, { status: 400 });
    }
  }

  const discountAmountMinor = discount
    ? discount.type === "PERCENT"
      ? Math.round((subtotalMinor * discount.value) / 100)
      : Math.min(discount.value, subtotalMinor)
    : 0;
  const amountMinor = subtotalMinor - discountAmountMinor;

  if (amountMinor <= 0) {
    return NextResponse.json({ error: "This discount would reduce the order to zero — pick a smaller code or a larger order." }, { status: 400 });
  }

  let order: CommerceOrder | null = null;
  let lastError: unknown = null;

  // Sentinels for the three distinct failure modes below, thrown at the exact call site
  // that hit them — NOT classified afterward by inspecting the caught error's `meta`.
  // The Neon driver adapter's P2002 errors carry `meta: { modelName, driverAdapterError }`
  // with no `target` field at all (unlike the classic Prisma error shape), so matching on
  // meta.target silently misclassifies every collision here and lets it escape as an
  // uncaught 500 — catching each Prisma call individually sidesteps that entirely.
  class OutOfStockError extends Error {}
  class OrderCodeCollisionError extends Error {}
  class SlotTakenError extends Error {}
  class InvalidDiscountError extends Error {}

  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    const orderNumber = generateOrderNumber();
    const reference = generatePaystackReference();
    try {
      order = await prisma.$transaction(async (tx) => {
        if (product.kind === "PHYSICAL" && product.stockQuantity !== null) {
          // Guarded update, not read-then-write: zero rows affected means someone else
          // already took the remaining stock, not "usually did" — see the Commerce plan.
          const stockUpdate = await tx.commerceProduct.updateMany({
            where: { id: product.id, stockQuantity: { gte: quantity } },
            data: { stockQuantity: { decrement: quantity } },
          });
          if (stockUpdate.count === 0) {
            throw new OutOfStockError();
          }
        }

        if (discount) {
          // Atomic guarded claim, not read-then-write — a raw UPDATE because Prisma's
          // query API can't express "usedCount < usageLimit" (comparing two columns of the
          // same row) any other way. Zero rows affected means someone else just spent the
          // last use (or it went inactive/expired) between the pre-check above and now.
          const claimed = await tx.$executeRaw`
            UPDATE "CommerceDiscountCode"
            SET "usedCount" = "usedCount" + 1
            WHERE id = ${discount.id}
              AND active = true
              AND ("expiresAt" IS NULL OR "expiresAt" > now())
              AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")
          `;
          if (claimed === 0) {
            throw new InvalidDiscountError();
          }
        }

        const createdOrder = await tx.commerceOrder
          .create({
            data: {
              templateId,
              organizationId,
              orderNumber,
              customerEmail,
              customerName: typeof customerName === "string" ? customerName : null,
              customerPhone: typeof customerPhone === "string" ? customerPhone : null,
              deliveryMethod: deliveryMethodValue,
              deliveryFeeMinor: 0,
              discountCode: discount?.code ?? null,
              discountAmountMinor,
              amountMinor,
              currency: product.currency,
              paymentProvider: settings.paymentProvider,
              // Platform Paystack has no per-site test/live split (a single ops-controlled
              // key, see resolveCheckoutPaystackSecret) — paystackMode only means anything
              // for BYO_PAYSTACK. Stripe orders use neither field (see
              // stripeCheckoutSessionId instead, set after this transaction commits).
              paystackMode: isStripeFlow || paystackKeys?.isPlatform ? null : settings.paystackMode,
              paystackReference: isStripeFlow ? null : reference,
              items: {
                create: [
                  {
                    productId: product.id,
                    nameSnapshot: product.name,
                    unitPriceMinor: product.priceMinor,
                    quantity,
                  },
                ],
              },
            },
          })
          .catch((err) => {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
              throw new OrderCodeCollisionError();
            }
            throw err;
          });

        if (product.kind === "SERVICE" && scheduledStart && scheduledEnd) {
          // A previous visitor's abandoned hold on this EXACT slot doesn't get cleaned up
          // until the expire-stale-holds cron next runs (daily — see vercel.json), but a
          // slot listing already treats it as free the moment holdExpiresAt passes (see
          // lib/commerce/availability.ts's query filter). Clearing it inline here, right
          // before claiming the slot, means correctness never depends on cron cadence —
          // the cron becomes pure housekeeping (stock restoration, general cleanup), not
          // something a real booking attempt can be silently blocked behind for a day.
          await tx.commerceBooking.deleteMany({
            where: { productId: product.id, scheduledStart, status: "PENDING_PAYMENT", holdExpiresAt: { lt: new Date() } },
          });

          // @@unique([productId, scheduledStart]) is the actual race guard — a second
          // concurrent request for the same slot fails here at the database, not
          // "usually" in application logic.
          await tx.commerceBooking
            .create({
              data: {
                templateId,
                organizationId,
                orderId: createdOrder.id,
                productId: product.id,
                scheduledStart,
                scheduledEnd,
                holdExpiresAt: new Date(Date.now() + 15 * 60_000),
              },
            })
            .catch((err) => {
              if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
                throw new SlotTakenError();
              }
              throw err;
            });
        }

        return createdOrder;
      });
    } catch (err) {
      lastError = err;
      if (err instanceof OrderCodeCollisionError) {
        continue; // collision on a random code — retry with a fresh one
      }
      if (err instanceof SlotTakenError) {
        return NextResponse.json({ error: "That time slot was just booked by someone else. Please pick another." }, { status: 409 });
      }
      if (err instanceof OutOfStockError) {
        return NextResponse.json({ error: `Only ${product.stockQuantity ?? 0} left in stock.` }, { status: 409 });
      }
      if (err instanceof InvalidDiscountError) {
        return NextResponse.json({ error: "That discount code isn't valid." }, { status: 400 });
      }
      throw err;
    }
  }

  if (!order) {
    throw lastError instanceof Error ? lastError : new Error("Failed to create Commerce order after retries.");
  }

  const callbackUrl = `${request.nextUrl.origin}/order-confirmation?order=${order.orderNumber}&email=${encodeURIComponent(customerEmail)}`;

  try {
    let authorizationUrl: string;

    if (isStripeFlow) {
      const session = await createCommerceStripeCheckoutSession({
        orderId: order.id,
        amountMinor,
        currency: product.currency,
        customerEmail,
        productName: product.name,
        successUrl: callbackUrl,
        cancelUrl: `${request.nextUrl.origin}/checkout`,
      });
      await prisma.commerceOrder.update({ where: { id: order.id }, data: { stripeCheckoutSessionId: session.id } });
      authorizationUrl = session.url;
    } else {
      // paystackKeys is confirmed non-null above (isStripeFlow is false in this branch).
      const secretKey = paystackKeys!.isPlatform ? paystackKeys!.secretKeyEncrypted! : decryptPaystackKey(paystackKeys!.secretKeyEncrypted!);
      const result = await initializePaystackTransaction({
        secretKey,
        email: customerEmail,
        amountMinor,
        // Same reasoning as the cart checkout route: email travels alongside order because
        // the strict order-lookup endpoint requires both together, and /order-confirmation
        // (not "/") is the default landing spot for a site with a dedicated confirmation
        // page — see the Commerce plan's runtime section.
        reference: order.paystackReference!,
        callbackUrl,
        metadata: { orderId: order.id, orderNumber: order.orderNumber, templateId },
      });
      await prisma.commerceOrder.update({ where: { id: order.id }, data: { paystackAuthorizationUrl: result.authorizationUrl } });
      authorizationUrl = result.authorizationUrl;
    }

    return NextResponse.json({
      orderNumber: order.orderNumber,
      reference: order.paystackReference,
      authorizationUrl,
    });
  } catch {
    // Paystack itself rejected the initialize call — mark the order FAILED rather than
    // leaving a PENDING order with no way to ever get paid, and release anything it held.
    await prisma.$transaction(async (tx) => {
      await tx.commerceOrder.update({ where: { id: order.id }, data: { status: "FAILED" } });
      if (product.kind === "PHYSICAL" && product.stockQuantity !== null) {
        await tx.commerceProduct.update({ where: { id: product.id }, data: { stockQuantity: { increment: quantity } } });
      }
      if (product.kind === "SERVICE") {
        // Deleted, not status-flipped to CANCELLED: @@unique([productId, scheduledStart])
        // has no notion of status, so a row left behind here — even cancelled — would
        // permanently squat that slot and make it unbookable by anyone, forever. The order
        // itself keeps the full history (status FAILED); only the slot-holding row goes.
        await tx.commerceBooking.deleteMany({ where: { orderId: order.id } });
      }
      if (discount) {
        // Release the claimed use — a failed-to-even-start payment shouldn't burn a
        // customer's discount code.
        await tx.commerceDiscountCode.update({ where: { id: discount.id }, data: { usedCount: { decrement: 1 } } });
      }
    });
    return NextResponse.json({ error: "Unable to start payment. Please try again." }, { status: 502 });
  }
}
