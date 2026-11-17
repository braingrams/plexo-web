import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { runLivePriceMoves } from "@/lib/billing/priceMoveLive";

export const maxDuration = 300;

/**
 * GET /api/internal/price-moves[?apply=1]
 *
 * Moves people who already subscribe to a changed price at their next renewal (lib/billing/priceMove.ts,
 * docs/PRICE_CHANGES.md). A DRY RUN unless ?apply=1 — the schedule in cdk/lib/published-sites-stack.ts
 * passes it. Same secret as every other internal cron route (x-cron-secret), or a signed-in admin.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const apply = request.nextUrl.searchParams.get("apply") === "1";
  return NextResponse.json(await runLivePriceMoves({ apply }));
}
