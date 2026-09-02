import { NextRequest, NextResponse } from "next/server";

import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { computeAvailableSlots } from "@/lib/commerce/availability";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";
import { CommerceProduct, CommerceAvailabilityRule, CommerceAvailabilityException, CommerceBooking } from "@/lib/db/commerceEntities";

const DEFAULT_RANGE_DAYS = 14;
const MAX_RANGE_DAYS = 60;

/**
 * Lists open booking slots for a service between `from` and `to` (ISO datetimes, both
 * optional — defaults to "now" through 14 days out, capped at 60 days to bound the
 * computation). Computed on the fly from CommerceAvailabilityRule/Exception + existing
 * bookings each call, never pre-materialized — see the Commerce plan.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
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

  const { data: product } = await CommerceProduct.get({ templateId, id: productId }).go();
  if (!product || product.kind !== "SERVICE" || !(product.active ?? true)) {
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

  // CommerceBooking has no productId-indexed access pattern (primary key is
  // templateId+orderId, byOrg GSI1 is organizationId+scheduledStart+id — see
  // commerceEntities.ts) — the closest available index is byOrg, range-bounded by the
  // same from/to window, then filtered by productId/templateId in memory. Bounded by one
  // org's booking volume in a <=60-day window, not the whole table.
  const [{ data: ruleRows }, { data: exceptionRows }, { data: orgBookingsInRange }] = await Promise.all([
    CommerceAvailabilityRule.query.byProduct({ productId }).go(),
    CommerceAvailabilityException.query
      .byProduct({ productId })
      .between({ date: effectiveFrom.toISOString() }, { date: cappedTo.toISOString() })
      .go(),
    CommerceBooking.query
      .byOrg({ organizationId: siteResult.published.organizationId })
      .between({ scheduledStart: effectiveFrom.toISOString() }, { scheduledStart: cappedTo.toISOString() })
      .go(),
  ]);

  const rules = ruleRows.map((r) => ({ dayOfWeek: r.dayOfWeek, startMinute: r.startMinute, endMinute: r.endMinute, timezone: r.timezone ?? "Africa/Lagos" }));
  const exceptions = exceptionRows.filter((e) => e.closed ?? true).map((e) => ({ date: new Date(e.date), closed: e.closed ?? true }));

  const nowMs = now.getTime();
  const existingBookings = orgBookingsInRange
    .filter(
      (b) =>
        b.templateId === templateId &&
        b.productId === productId &&
        new Date(b.scheduledEnd).getTime() >= effectiveFrom.getTime() &&
        (b.status === "CONFIRMED" || (b.status === "PENDING_PAYMENT" && b.holdExpiresAt && new Date(b.holdExpiresAt).getTime() > nowMs)),
    )
    .map((b) => ({ scheduledStart: new Date(b.scheduledStart), scheduledEnd: new Date(b.scheduledEnd) }));

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
