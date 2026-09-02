import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { CommerceOrder, CommerceOrderItem, CommerceProduct, CommerceBooking, CommerceBookingSlotLock } from "@/lib/db/commerceEntities";

// Matches the hold window checkout sets on a new booking (see
// lib/commerce/checkoutDynamo.ts) — an order still PENDING this long after creation means
// the visitor abandoned checkout without ever getting to (or completing) Paystack's page.
const STALE_ORDER_AGE_MS = 15 * 60_000;

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

/**
 * GET /api/internal/commerce/expire-stale-holds
 *
 * Sweeps orders stuck PENDING past the hold window and releases whatever they were
 * holding — restocks any physical items, and DELETES (not status-flips) any linked
 * booking + its slot lock. Deletion matters here: CommerceBookingSlotLock's uniqueness has
 * no notion of status, so a row left behind in any status would permanently squat that
 * slot and make it unbookable by anyone else, forever — see checkoutDynamo.ts's own
 * Paystack-failure rollback for the same reasoning.
 *
 * Every mutation is guarded by re-checking status: "PENDING" via a conditional update, so
 * a webhook that confirms payment between this sweep's query and its write always wins —
 * a stale-looking order that actually just got paid is left completely untouched, not
 * cancelled out from under a successful payment.
 *
 * CommerceOrder has no status-indexed access pattern across every site (primary is
 * templateId+id, byPaymentRef/byOrderNumber are for a single order lookup — see
 * commerceEntities.ts) — this only exists for this once-a-day internal job, so a bounded
 * Scan (filtered in application code, same as app/api/internal/scan-domains's
 * PublishedDomain scan) is the honest v1 answer rather than a GSI on the busiest entity
 * in the table for a low-frequency batch job.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isCronRequest = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCronRequest && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STALE_ORDER_AGE_MS).toISOString();

  type OrderRow = { id: string; templateId: string; status?: string; createdAt?: string };
  const allOrders: OrderRow[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { data: OrderRow[]; cursor: string | null } = await CommerceOrder.scan.go({ cursor });
    allOrders.push(...page.data);
    cursor = page.cursor;
    if (!cursor) break;
  }

  const staleOrders = allOrders.filter((o) => (o.status ?? "PENDING") === "PENDING" && (o.createdAt ?? "") < cutoff);

  let expiredCount = 0;
  for (const staleOrder of staleOrders) {
    try {
      await CommerceOrder.patch({ templateId: staleOrder.templateId, id: staleOrder.id })
        .set({ status: "CANCELLED" })
        .where((attr, op) => op.eq(attr.status, "PENDING"))
        .go();
    } catch (err) {
      if (isConditionalCheckFailure(err)) continue; // a webhook confirmed it first — leave it alone
      throw err;
    }

    const { data: items } = await CommerceOrderItem.query.primary({ templateId: staleOrder.templateId, orderId: staleOrder.id }).go();
    await Promise.all(
      items.map(async (item) => {
        const { data: product } = await CommerceProduct.get({ templateId: staleOrder.templateId, id: item.productId }).go();
        if (product && product.stockQuantity != null) {
          await CommerceProduct.patch({ templateId: staleOrder.templateId, id: item.productId }).add({ stockQuantity: item.quantity ?? 1 }).go();
        }
      }),
    );

    const { data: booking } = await CommerceBooking.get({ templateId: staleOrder.templateId, orderId: staleOrder.id }).go();
    if (booking && booking.status === "PENDING_PAYMENT") {
      await Promise.all([
        CommerceBooking.remove({ templateId: staleOrder.templateId, orderId: staleOrder.id }).go(),
        CommerceBookingSlotLock.remove({ productId: booking.productId, scheduledStart: booking.scheduledStart }).go(),
      ]);
    }

    expiredCount++;
  }

  return NextResponse.json({ expired: expiredCount });
}
