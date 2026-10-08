import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";
import { readCartToken, setCartCookie, findOpenCart, createCart, readCartSnapshot } from "@/lib/commerce/cartDynamo";
import { CommerceProduct, CommerceCartItem } from "@/lib/db/commerceEntities";
import { lineName, resolvePurchasable } from "@/lib/commerce/variants";

const MAX_QUANTITY = 50;

/** Adds a PHYSICAL product to the visitor's cart (upserts quantity if it's already in
 * there). Services never go through the cart — a booking's time-slot hold checks out
 * immediately via /api/public/commerce/checkout, same as before this cart existed. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  const siteResult = await resolveSite(hostname);
  if (siteResult.status !== "ok") {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  const { templateId, organization } = siteResult.published;

  const allowed = await checkCommerceRateLimit(`commerce:cart-add:${templateId}:${clientIp(request)}`, 30);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { productId?: unknown; variantId?: unknown; quantity?: unknown };
  if (typeof body.productId !== "string" || !body.productId) {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }
  const requestedQty = typeof body.quantity === "number" && Number.isInteger(body.quantity) && body.quantity > 0 ? body.quantity : 1;
  const quantity = Math.min(requestedQty, MAX_QUANTITY);

  const { data: product } = await CommerceProduct.get({ templateId, id: body.productId }).go();
  if (!product || !(product.active ?? true)) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }
  if (product.kind !== "PHYSICAL") {
    return NextResponse.json({ error: "This item is booked directly, not added to a cart." }, { status: 400 });
  }
  // Products with options (Size, Colour…) go in the cart as one specific variant.
  const purchase = resolvePurchasable(product, typeof body.variantId === "string" ? body.variantId : null);
  if (!purchase.ok) return NextResponse.json({ error: purchase.error }, { status: 400 });
  if (purchase.stockQuantity !== null && purchase.stockQuantity <= 0) {
    return NextResponse.json({ error: `${lineName(product.name, purchase.label)} is out of stock.` }, { status: 409 });
  }
  const variantId = purchase.variant?.id;

  let cart = await findOpenCart(templateId, readCartToken(request));
  if (!cart) cart = await createCart(templateId, organization.id);

  const { data: existingItems } = await CommerceCartItem.query.primary({ templateId, cartId: cart.id }).go({ pages: "all" });
  // Same product in a different size is a separate line.
  const existing = existingItems.find((i) => i.productId === product.id && (i.variantId ?? undefined) === variantId);
  if (existing) {
    await CommerceCartItem.patch({ templateId, cartId: cart.id, id: existing.id })
      .set({ quantity: Math.min((existing.quantity ?? 1) + quantity, MAX_QUANTITY), unitPriceMinorSnapshot: purchase.unitPriceMinor })
      .go();
  } else {
    await CommerceCartItem.create({
      id: randomUUID(),
      templateId,
      cartId: cart.id,
      productId: product.id,
      ...(variantId ? { variantId } : {}),
      quantity,
      unitPriceMinorSnapshot: purchase.unitPriceMinor,
    }).go();
  }

  const snapshot = await readCartSnapshot(templateId, cart.cartToken);
  const response = NextResponse.json(snapshot, { status: 201 });
  setCartCookie(response, cart.cartToken);
  return response;
}
