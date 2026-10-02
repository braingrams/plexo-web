import { NextRequest, NextResponse } from "next/server";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";
import { CommerceOrder, CommerceOrderItem, CommerceBooking, CommerceSettings } from "@/lib/db/commerceEntities";
import { publicBankDetails } from "@/lib/commerce/bankTransfer";

/** Powers order_confirmation and order_tracking. Requires an exact match on BOTH
 * orderNumber and email — deliberately, so nobody can browse another customer's order by
 * guessing a short human-facing code (see the Commerce plan's hardening notes). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
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

  const { data: matches } = await CommerceOrder.query.byOrderNumber({ orderNumber }).go();
  const order = matches.find((o) => o.templateId === templateId && o.customerEmail.toLowerCase() === email);
  if (!order) {
    return NextResponse.json({ error: "No order found with that number and email." }, { status: 404 });
  }

  const awaitingTransfer = order.paymentMethod === "BANK_TRANSFER" && order.status === "PENDING";
  const [{ data: items }, { data: booking }, { data: settings }] = await Promise.all([
    CommerceOrderItem.query.primary({ templateId, orderId: order.id }).go(),
    CommerceBooking.get({ templateId, orderId: order.id }).go(),
    awaitingTransfer ? CommerceSettings.get({ templateId }).go() : Promise.resolve({ data: null }),
  ]);

  return NextResponse.json({
    order: {
      orderNumber: order.orderNumber,
      status: order.status,
      fulfillmentStatus: order.fulfillmentStatus,
      deliveryMethod: order.deliveryMethod ?? null,
      deliveryMethodName: order.deliveryMethodNameSnapshot ?? null,
      pickupLocation: order.pickupLocationSnapshot ?? null,
      paymentMethod: order.paymentMethod ?? "ONLINE",
      // Only while the transfer is still unconfirmed — so the confirmation page can keep
      // showing the customer exactly where to send the money (with the order number as
      // the reference) if they placed the order before actually transferring.
      bankTransfer: awaitingTransfer ? publicBankDetails(settings) : null,
      amountMinor: order.amountMinor,
      currency: order.currency ?? "NGN",
      createdAt: order.createdAt,
      items: items.map((i) => ({ nameSnapshot: i.nameSnapshot, unitPriceMinor: i.unitPriceMinor, quantity: i.quantity ?? 1 })),
      booking: booking ? { scheduledStart: booking.scheduledStart, scheduledEnd: booking.scheduledEnd, status: booking.status } : null,
    },
  });
}
