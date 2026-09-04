import { randomBytes, randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { CommerceCart, CommerceCartItem, CommerceProduct, CommerceSettings } from "@/lib/db/commerceEntities";

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
  const { data: matches } = await CommerceCart.query.byToken({ cartToken: token }).go();
  const cart = matches[0];
  if (!cart || cart.templateId !== templateId || cart.status !== "OPEN") return null;
  return cart;
}

export async function createCart(templateId: string, organizationId: string) {
  const token = randomBytes(24).toString("hex");
  const id = randomUUID();
  await CommerceCart.create({ id, templateId, organizationId, cartToken: token, status: "OPEN" }).go();
  const { data: cart } = await CommerceCart.get({ templateId, id }).go();
  if (!cart) throw new Error(`CommerceCart ${id} vanished immediately after being created`);
  return cart;
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
    kind: string;
  }>;
  subtotalMinor: number;
  currency: string;
};

/** Reads live product data for the price/stock shown — never the stale cart-item snapshot,
 * so a visitor sees a price change (or a since-sold-out item) before they pay for it. */
export async function readCartSnapshot(templateId: string, token: string | null): Promise<CartSnapshot> {
  // Currency is a site-wide setting (Settings > General), not a per-product value —
  // reading it from the first item's own product used to mean an empty/mixed cart could
  // show the wrong currency; the site's own setting is always right regardless of what's
  // actually in the cart.
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  const currency = settings?.currency ?? "NGN";

  const cart = await findOpenCart(templateId, token);
  if (!cart) return { cartToken: null, items: [], subtotalMinor: 0, currency };

  const { data: items } = await CommerceCartItem.query.primary({ templateId, cartId: cart.id }).go();
  items.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  const products = await Promise.all(items.map((item) => CommerceProduct.get({ templateId, id: item.productId }).go()));

  const snapshot: CartSnapshot = { cartToken: cart.cartToken, items: [], subtotalMinor: 0, currency };
  items.forEach((item, i) => {
    const product = products[i].data;
    if (!product || !(product.active ?? true)) return;
    const lineTotal = product.priceMinor * (item.quantity ?? 1);
    snapshot.items.push({
      itemId: item.id,
      productId: product.id,
      name: product.name,
      slug: product.slug,
      imageUrl: product.imageUrl ?? null,
      unitPriceMinor: product.priceMinor,
      quantity: item.quantity ?? 1,
      lineTotalMinor: lineTotal,
      inStock: product.stockQuantity == null || product.stockQuantity >= (item.quantity ?? 1),
      kind: product.kind ?? "PHYSICAL",
    });
    snapshot.subtotalMinor += lineTotal;
  });
  return snapshot;
}
