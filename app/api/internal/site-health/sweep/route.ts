import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { sweepWeekly, takeJobLock } from "@/lib/siteHealth/recheck";

export const maxDuration = 60;

/**
 * GET /api/internal/site-health/sweep
 *
 * The weekly turn: finds live sites whose last Site health check is over a week old (or never ran) and puts them in the
 * re-check queue, up to 300 per sweep. It only queues; app/api/internal/site-health/recheck runs the checks at a pace the cost
 * limits allow. Scheduled hourly (cdk/lib/published-sites-stack.ts), so a large backlog drains over a few hours, not all at once.
 *
 * PublishedDomain has no index over `active`, so this is a table scan, the same trade-off app/api/internal/scan-domains makes.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!(await takeJobLock("sweep", 50 * 60 * 1000))) return NextResponse.json({ skipped: "ran recently" });
  return NextResponse.json(await sweepWeekly());
}
