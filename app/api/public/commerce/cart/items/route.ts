import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveSite } from "@/lib/pub/resolveSite";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimit";
import { readCartToken, setCartCookie, findOpenCart, createCart, readCartSnapshot } from "@/lib/commerce/cart";

const MAX_QUANTITY = 50;

/** Adds a PHYSICAL product to the visitor's cart (upserts quantity if it's already in
 * there). Services never go through the cart — a booking's time-slot hold checks out
 * immediately via /api/public/commerce/checkout, same as before this cart existed. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("host") ?? "").split(":")[0];
  const siteResult = await resolveSite(hostname);
  if (siteResult.status !== "ok") {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  const { templateId, organization } = siteResult.published;

  const allowed = await checkCommerceRateLimit(`commerce:cart-add:${templateId}:${clientIp(request)}`, 30);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { productId?: unknown; quantity?: unknown };
  if (typeof body.productId !== "string" || !body.productId) {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }
  const requestedQty = typeof body.quantity === "number" && Number.isInteger(body.quantity) && body.quantity > 0 ? body.quantity : 1;
  const quantity = Math.min(requestedQty, MAX_QUANTITY);

  const product = await prisma.commerceProduct.findFirst({ where: { id: body.productId, templateId, active: true } });
  if (!product) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }
  if (product.kind !== "PHYSICAL") {
    return NextResponse.json({ error: "This item is booked directly, not added to a cart." }, { status: 400 });
  }

  let cart = await findOpenCart(templateId, readCartToken(request));
  if (!cart) cart = await createCart(templateId, organization.id);

  const existing = await prisma.commerceCartItem.findUnique({ where: { cartId_productId: { cartId: cart.id, productId: product.id } } });
  if (existing) {
    await prisma.commerceCartItem.update({
      where: { id: existing.id },
      data: { quantity: Math.min(existing.quantity + quantity, MAX_QUANTITY), unitPriceMinorSnapshot: product.priceMinor },
    });
  } else {
    await prisma.commerceCartItem.create({
      data: { cartId: cart.id, productId: product.id, quantity, unitPriceMinorSnapshot: product.priceMinor },
    });
  }

  const snapshot = await readCartSnapshot(templateId, cart.cartToken);
  const response = NextResponse.json(snapshot, { status: 201 });
  setCartCookie(response, cart.cartToken);
  return response;
}
