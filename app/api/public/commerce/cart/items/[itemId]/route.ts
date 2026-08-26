import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveSite } from "@/lib/pub/resolveSite";
import { readCartToken, findOpenCart, readCartSnapshot } from "@/lib/commerce/cart";

const MAX_QUANTITY = 50;

type OwnedItemResolution =
  | { error: NextResponse }
  | { templateId: string; cart: Awaited<ReturnType<typeof findOpenCart>> & object; item: Awaited<ReturnType<typeof prisma.commerceCartItem.findFirst>> & object };

async function resolveOwnedItem(request: NextRequest, itemId: string): Promise<OwnedItemResolution> {
  const hostname = (request.headers.get("host") ?? "").split(":")[0];
  const siteResult = await resolveSite(hostname);
  if (siteResult.status !== "ok") return { error: NextResponse.json({ error: "Site not found." }, { status: 404 }) };

  const { templateId } = siteResult.published;
  const cart = await findOpenCart(templateId, readCartToken(request));
  // Never trust itemId alone — it must belong to THIS visitor's own cart cookie, or a
  // guessed/enumerated id could edit a stranger's cart.
  if (!cart) return { error: NextResponse.json({ error: "No cart found." }, { status: 404 }) };

  const item = await prisma.commerceCartItem.findFirst({ where: { id: itemId, cartId: cart.id } });
  if (!item) return { error: NextResponse.json({ error: "Item not found in your cart." }, { status: 404 }) };

  return { templateId, cart, item };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ itemId: string }> }): Promise<NextResponse> {
  const { itemId } = await context.params;
  const resolved = await resolveOwnedItem(request, itemId);
  if ("error" in resolved) return resolved.error;

  const body = (await request.json().catch(() => ({}))) as { quantity?: unknown };
  const quantity = typeof body.quantity === "number" && Number.isInteger(body.quantity) ? body.quantity : null;
  if (quantity === null) {
    return NextResponse.json({ error: "quantity must be an integer." }, { status: 400 });
  }

  if (quantity <= 0) {
    await prisma.commerceCartItem.delete({ where: { id: itemId } });
  } else {
    await prisma.commerceCartItem.update({ where: { id: itemId }, data: { quantity: Math.min(quantity, MAX_QUANTITY) } });
  }

  return NextResponse.json(await readCartSnapshot(resolved.templateId, resolved.cart.cartToken));
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ itemId: string }> }): Promise<NextResponse> {
  const { itemId } = await context.params;
  const resolved = await resolveOwnedItem(request, itemId);
  if ("error" in resolved) return resolved.error;

  await prisma.commerceCartItem.delete({ where: { id: itemId } });
  return NextResponse.json(await readCartSnapshot(resolved.templateId, resolved.cart.cartToken));
}
