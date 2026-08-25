import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { isAuthorizedAdmin } from "@/server/adminAuth";

// Matches the hold window checkout sets on a new booking (see
// app/api/public/commerce/checkout/route.ts) — an order still PENDING this long after
// creation means the visitor abandoned checkout without ever getting to (or completing)
// Paystack's page.
const STALE_ORDER_AGE_MS = 15 * 60_000;

/**
 * GET /api/internal/commerce/expire-stale-holds
 *
 * Sweeps orders stuck PENDING past the hold window and releases whatever they were
 * holding — restocks any physical items, and DELETES (not status-flips) any linked
 * booking. Deletion matters here: @@unique([productId, scheduledStart]) has no notion of
 * status, so a booking row left behind in any status would permanently squat that slot
 * and make it unbookable by anyone else, forever — see the checkout route's own
 * Paystack-failure rollback for the same reasoning.
 *
 * Every mutation is guarded by re-checking status: "PENDING" inside its own transaction,
 * so a webhook that confirms payment between this sweep's query and its write always wins
 * — a stale-looking order that actually just got paid is left completely untouched, not
 * cancelled out from under a successful payment.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isCronRequest = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCronRequest && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STALE_ORDER_AGE_MS);
  const staleOrders = await prisma.commerceOrder.findMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
    select: {
      id: true,
      items: { select: { productId: true, quantity: true } },
      booking: { select: { id: true } },
    },
  });

  let expiredCount = 0;
  for (const staleOrder of staleOrders) {
    await prisma.$transaction(async (tx) => {
      const orderUpdate = await tx.commerceOrder.updateMany({
        where: { id: staleOrder.id, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      if (orderUpdate.count === 0) return; // a webhook confirmed it first — leave it alone

      for (const item of staleOrder.items) {
        await tx.commerceProduct.updateMany({
          where: { id: item.productId, stockQuantity: { not: null } },
          data: { stockQuantity: { increment: item.quantity } },
        });
      }
      if (staleOrder.booking) {
        await tx.commerceBooking.deleteMany({ where: { id: staleOrder.booking.id, status: "PENDING_PAYMENT" } });
      }
    });
    expiredCount++;
  }

  return NextResponse.json({ expired: expiredCount });
}
