import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveSite } from "@/lib/pub/resolveSite";
import { computeAvailableSlots } from "@/lib/commerce/availability";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimit";

const DEFAULT_RANGE_DAYS = 14;
const MAX_RANGE_DAYS = 60;

/**
 * Lists open booking slots for a service between `from` and `to` (ISO datetimes, both
 * optional — defaults to "now" through 14 days out, capped at 60 days to bound the
 * computation). Computed on the fly from CommerceAvailabilityRule/Exception + existing
 * bookings each call, never pre-materialized — see the Commerce plan.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("host") ?? "").split(":")[0];
  const siteResult = await resolveSite(hostname);
  if (siteResult.status !== "ok") {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  const { templateId } = siteResult.published;

  const allowed = await checkCommerceRateLimit(`commerce:availability:${templateId}:${clientIp(request)}`, 60);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  const productId = request.nextUrl.searchParams.get("productId");
  if (!productId) {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }

  const product = await prisma.commerceProduct.findFirst({
    where: { id: productId, templateId, active: true, kind: "SERVICE" },
  });
  if (!product) {
    return NextResponse.json({ error: "Service not found." }, { status: 404 });
  }

  const now = new Date();
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");

  const from = fromParam ? new Date(fromParam) : now;
  const to = toParam ? new Date(toParam) : new Date(from.getTime() + DEFAULT_RANGE_DAYS * 24 * 60 * 60_000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to.getTime() < from.getTime()) {
    return NextResponse.json({ error: "Invalid from/to range." }, { status: 400 });
  }
  const maxTo = new Date(from.getTime() + MAX_RANGE_DAYS * 24 * 60 * 60_000);
  const cappedTo = to.getTime() > maxTo.getTime() ? maxTo : to;

  const effectiveFrom = from.getTime() < now.getTime() ? now : from;

  const [rules, exceptions, existingBookings] = await Promise.all([
    prisma.commerceAvailabilityRule.findMany({
      where: { productId },
      select: { dayOfWeek: true, startMinute: true, endMinute: true, timezone: true },
    }),
    prisma.commerceAvailabilityException.findMany({
      where: { productId, closed: true, date: { gte: effectiveFrom, lte: cappedTo } },
      select: { date: true, closed: true },
    }),
    prisma.commerceBooking.findMany({
      where: {
        productId,
        scheduledEnd: { gte: effectiveFrom },
        scheduledStart: { lte: cappedTo },
        OR: [{ status: "CONFIRMED" }, { status: "PENDING_PAYMENT", holdExpiresAt: { gt: now } }],
      },
      select: { scheduledStart: true, scheduledEnd: true },
    }),
  ]);

  const slots = computeAvailableSlots({
    from: effectiveFrom,
    to: cappedTo,
    durationMinutes: product.durationMinutes ?? 60,
    rules,
    exceptions,
    existingBookings,
  });

  return NextResponse.json({
    slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
  });
}
