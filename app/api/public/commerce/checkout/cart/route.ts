import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { Prisma, type CommerceOrder } from "@prisma/client";

import { prisma } from "@/server/prisma";
import { resolveSite } from "@/lib/pub/resolveSite";
import { decryptPaystackKey } from "@/lib/crypto";
import { initializePaystackTransaction } from "@/lib/paystack";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimit";
import { readCartToken, findOpenCart, clearCartCookie } from "@/lib/commerce/cart";

// Placeholder flat courier fee until a site owner can configure their own delivery pricing
// (not modeled anywhere yet — CommerceSettings has no delivery-fee field). Matches the "from
// ₦1,500" figure already shown on the approved Checkout design.
const COURIER_FEE_MINOR = 150_000;

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
  const hostname = (request.headers.get("host") ?? "").split(":")[0];
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
  const { customerEmail, customerName, customerPhone, deliveryMethod, discountCode: rawDiscountCode } = body;

  if (typeof customerEmail !== "string" || !isValidEmail(customerEmail)) {
    return NextResponse.json({ error: "A valid customerEmail is required." }, { status: 400 });
  }
  const deliveryMethodValue = deliveryMethod === "PICKUP" || deliveryMethod === "COURIER" ? deliveryMethod : "PICKUP";
  const deliveryFeeMinor = deliveryMethodValue === "COURIER" ? COURIER_FEE_MINOR : 0;

  const settings = await prisma.commerceSettings.findUnique({ where: { templateId } });
  if (!settings || !settings.enabled || !settings.paystackSecretKeyEncrypted || !settings.paystackPublicKey) {
    return NextResponse.json({ error: "Commerce is not enabled for this site." }, { status: 400 });
  }

  const cartItems = await prisma.commerceCartItem.findMany({ where: { cartId: cart.id }, include: { product: true } });
  const activeItems = cartItems.filter((i) => i.product.active);
  if (activeItems.length === 0) {
    return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
  }
  const currency = activeItems[0].product.currency;

  // Prices are never trusted from the cart snapshot at this point either — re-read fresh
  // right before charging, same "server always re-derives the amount" rule the single-
  // product checkout follows.
  const subtotalMinor = activeItems.reduce((sum, item) => sum + item.product.priceMinor * item.quantity, 0);

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
  const amountMinor = subtotalMinor + deliveryFeeMinor - discountAmountMinor;

  if (amountMinor <= 0) {
    return NextResponse.json({ error: "This discount would reduce the order to zero — pick a smaller code or a larger order." }, { status: 400 });
  }

  let order: CommerceOrder | null = null;
  let lastError: unknown = null;
  let outOfStockProductName: string | null = null;

  class OutOfStockError extends Error {
    constructor(public productName: string) {
      super();
    }
  }
  class OrderCodeCollisionError extends Error {}
  class InvalidDiscountError extends Error {}

  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    const orderNumber = generateOrderNumber();
    const reference = generatePaystackReference();
    try {
      order = await prisma.$transaction(async (tx) => {
        for (const item of activeItems) {
          if (item.product.stockQuantity !== null) {
            const stockUpdate = await tx.commerceProduct.updateMany({
              where: { id: item.product.id, stockQuantity: { gte: item.quantity } },
              data: { stockQuantity: { decrement: item.quantity } },
            });
            if (stockUpdate.count === 0) {
              throw new OutOfStockError(item.product.name);
            }
          }
        }

        if (discount) {
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
              cartId: cart.id,
              customerEmail,
              customerName: typeof customerName === "string" ? customerName : null,
              customerPhone: typeof customerPhone === "string" ? customerPhone : null,
              deliveryMethod: deliveryMethodValue,
              deliveryFeeMinor,
              discountCode: discount?.code ?? null,
              discountAmountMinor,
              amountMinor,
              currency,
              paystackMode: settings.paystackMode,
              paystackReference: reference,
              items: {
                create: activeItems.map((item) => ({
                  productId: item.product.id,
                  nameSnapshot: item.product.name,
                  unitPriceMinor: item.product.priceMinor,
                  quantity: item.quantity,
                })),
              },
            },
          })
          .catch((err) => {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
              throw new OrderCodeCollisionError();
            }
            throw err;
          });

        await tx.commerceCart.update({ where: { id: cart.id }, data: { status: "CONVERTED", customerEmail } });

        return createdOrder;
      });
    } catch (err) {
      lastError = err;
      if (err instanceof OrderCodeCollisionError) {
        continue;
      }
      if (err instanceof OutOfStockError) {
        outOfStockProductName = err.productName;
        return NextResponse.json({ error: `"${err.productName}" just sold out — remove it from your cart to continue.` }, { status: 409 });
      }
      if (err instanceof InvalidDiscountError) {
        return NextResponse.json({ error: "That discount code isn't valid." }, { status: 400 });
      }
      throw err;
    }
  }

  if (!order) {
    if (outOfStockProductName) {
      return NextResponse.json({ error: `"${outOfStockProductName}" just sold out.` }, { status: 409 });
    }
    throw lastError instanceof Error ? lastError : new Error("Failed to create Commerce order after retries.");
  }

  const secretKey = decryptPaystackKey(settings.paystackSecretKeyEncrypted);

  try {
    const result = await initializePaystackTransaction({
      secretKey,
      email: customerEmail,
      amountMinor,
      reference: order.paystackReference,
      // email travels alongside order — the order-confirmation page has no session/account
      // to identify the visitor with, and the strict order-lookup endpoint deliberately
      // requires orderNumber+email together (never orderNumber alone) to prevent a stranger
      // from browsing someone else's order by guessing a short code. The visitor just typed
      // this email into the checkout form seconds ago, so this is a same-session redirect,
      // not a new disclosure.
      callbackUrl: `${request.nextUrl.origin}/order-confirmation?order=${order.orderNumber}&email=${encodeURIComponent(customerEmail)}`,
      metadata: { orderId: order.id, orderNumber: order.orderNumber, templateId },
    });

    await prisma.commerceOrder.update({ where: { id: order.id }, data: { paystackAuthorizationUrl: result.authorizationUrl } });

    const response = NextResponse.json({ orderNumber: order.orderNumber, reference: order.paystackReference, authorizationUrl: result.authorizationUrl });
    clearCartCookie(response);
    return response;
  } catch {
    await prisma.$transaction(async (tx) => {
      // Clears cartId too (not just status: FAILED) — CommerceOrder.cartId is unique, so a
      // retry that creates a fresh order against this same reopened cart would otherwise
      // collide with this failed one still holding the slot.
      await tx.commerceOrder.update({ where: { id: order.id }, data: { status: "FAILED", cartId: null } });
      for (const item of activeItems) {
        if (item.product.stockQuantity !== null) {
          await tx.commerceProduct.update({ where: { id: item.product.id }, data: { stockQuantity: { increment: item.quantity } } });
        }
      }
      if (discount) {
        await tx.commerceDiscountCode.update({ where: { id: discount.id }, data: { usedCount: { decrement: 1 } } });
      }
      // Reopen the cart so the visitor doesn't lose their items over a Paystack hiccup.
      await tx.commerceCart.update({ where: { id: cart.id }, data: { status: "OPEN" } });
    });
    return NextResponse.json({ error: "Unable to start payment. Please try again." }, { status: 502 });
  }
}
