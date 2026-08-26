import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveSite } from "@/lib/pub/resolveSite";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimit";

/** Powers order_confirmation and order_tracking. Requires an exact match on BOTH
 * orderNumber and email — deliberately, so nobody can browse another customer's order by
 * guessing a short human-facing code (see the Commerce plan's hardening notes). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("host") ?? "").split(":")[0];
  const siteResult = await resolveSite(hostname);
  if (siteResult.status !== "ok") {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  const { templateId } = siteResult.published;

  const allowed = await checkCommerceRateLimit(`commerce:order-lookup:${templateId}:${clientIp(request)}`, 20);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  const orderNumber = request.nextUrl.searchParams.get("orderNumber")?.trim();
  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!orderNumber || !email) {
    return NextResponse.json({ error: "orderNumber and email are required." }, { status: 400 });
  }

  const order = await prisma.commerceOrder.findFirst({
    where: { templateId, orderNumber, customerEmail: { equals: email, mode: "insensitive" } },
    include: {
      items: { select: { nameSnapshot: true, unitPriceMinor: true, quantity: true } },
      booking: { select: { scheduledStart: true, scheduledEnd: true, status: true } },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "No order found with that number and email." }, { status: 404 });
  }

  return NextResponse.json({
    order: {
      orderNumber: order.orderNumber,
      status: order.status,
      fulfillmentStatus: order.fulfillmentStatus,
      deliveryMethod: order.deliveryMethod,
      amountMinor: order.amountMinor,
      currency: order.currency,
      createdAt: order.createdAt,
      items: order.items,
      booking: order.booking,
    },
  });
}
