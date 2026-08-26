import { randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";

/**
 * Multi-item cart for the shop_grid/cart_summary/checkout_flow marker family — separate
 * from the single-product "buy now" flow in app/api/public/commerce/checkout/route.ts,
 * which stays as-is for a `product`/`booking` block's direct purchase. Identified by an
 * httpOnly cookie, same "no customer account needed" shape the Commerce plan's data model
 * always intended for CommerceCart.
 */
export const CART_COOKIE = "plexo_cart_token";

export function readCartToken(request: NextRequest): string | null {
  return request.cookies.get(CART_COOKIE)?.value ?? null;
}

export function setCartCookie(response: NextResponse, token: string): void {
  response.cookies.set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearCartCookie(response: NextResponse): void {
  response.cookies.delete(CART_COOKIE);
}

/**
 * Looks up the visitor's OPEN cart for this exact site (never returns another site's cart,
 * or a cart already converted to an order) — null when there's nothing to find, letting
 * callers decide whether to create one.
 */
export async function findOpenCart(templateId: string, token: string | null) {
  if (!token) return null;
  const cart = await prisma.commerceCart.findUnique({ where: { cartToken: token } });
  if (!cart || cart.templateId !== templateId || cart.status !== "OPEN") return null;
  return cart;
}

export async function createCart(templateId: string, organizationId: string) {
  const token = randomBytes(24).toString("hex");
  return prisma.commerceCart.create({ data: { templateId, organizationId, cartToken: token, status: "OPEN" } });
}

export type CartSnapshot = {
  cartToken: string | null;
  items: Array<{
    itemId: string;
    productId: string;
    name: string;
    slug: string;
    imageUrl: string | null;
    unitPriceMinor: number;
    quantity: number;
    lineTotalMinor: number;
    inStock: boolean;
  }>;
  subtotalMinor: number;
  currency: string;
};

/** Reads live product data for the price/stock shown — never the stale cart-item snapshot,
 * so a visitor sees a price change (or a since-sold-out item) before they pay for it. */
export async function readCartSnapshot(templateId: string, token: string | null): Promise<CartSnapshot> {
  const cart = await findOpenCart(templateId, token);
  if (!cart) return { cartToken: null, items: [], subtotalMinor: 0, currency: "NGN" };

  const items = await prisma.commerceCartItem.findMany({
    where: { cartId: cart.id },
    include: { product: { select: { id: true, name: true, slug: true, imageUrl: true, priceMinor: true, currency: true, stockQuantity: true, active: true } } },
    orderBy: { createdAt: "asc" },
  });

  const snapshot: CartSnapshot = { cartToken: cart.cartToken, items: [], subtotalMinor: 0, currency: items[0]?.product.currency ?? "NGN" };
  for (const item of items) {
    if (!item.product.active) continue;
    const lineTotal = item.product.priceMinor * item.quantity;
    snapshot.items.push({
      itemId: item.id,
      productId: item.product.id,
      name: item.product.name,
      slug: item.product.slug,
      imageUrl: item.product.imageUrl,
      unitPriceMinor: item.product.priceMinor,
      quantity: item.quantity,
      lineTotalMinor: lineTotal,
      inStock: item.product.stockQuantity === null || item.product.stockQuantity >= item.quantity,
    });
    snapshot.subtotalMinor += lineTotal;
  }
  return snapshot;
}
