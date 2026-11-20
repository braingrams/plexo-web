import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { processRecheckQueue, takeJobLock } from "@/lib/siteHealth/recheck";

export const maxDuration = 60;

/**
 * GET /api/internal/site-health/recheck
 *
 * Runs the automatic Site health re-checks that are due: sites changed (published, edited, or a fix switched on or off) at least
 * 15 minutes ago, and sites queued for their weekly turn (app/api/internal/site-health/sweep). Scheduled every 10 minutes by
 * cdk/lib/published-sites-stack.ts. Each run is limited by time and by the cost limits in lib/siteHealth/service.ts; whatever
 * is left stays queued for the next run.
 *
 * EventBridge gives an API destination 5 seconds before it counts a call as failed and retries it, so a lock keeps a retried
 * call from starting a second run while the first is still working.
 *
 * Accepts the x-cron-secret header (lib/cronAuth.ts) or the internal admin token, so it can be run by hand.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!(await takeJobLock("recheck", 4 * 60 * 1000))) return NextResponse.json({ skipped: "already running or ran a moment ago" });
  return NextResponse.json(await processRecheckQueue());
}
