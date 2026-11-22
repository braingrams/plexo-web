import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { sendWeeklyDigests } from "@/lib/siteHealth/digest";
import { takeJobLock } from "@/lib/siteHealth/recheck";

export const maxDuration = 60;

/**
 * GET /api/internal/site-health/digest
 *
 * Sends the weekly "Your site health" email to every owner who has it on (lib/siteHealth/digest.ts). Scheduled once a day by
 * cdk/lib/published-sites-stack.ts: each site is emailed at most once every 6 days, so a day's run only reaches the sites that are due and
 * a large backlog drains over a few days instead of in one burst. It reports an existing check and never runs a speed test.
 * Locked, because EventBridge retries a call that takes longer than its 5 second timeout.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!(await takeJobLock("digest", 20 * 60 * 60 * 1000))) return NextResponse.json({ skipped: "ran recently" });
  return NextResponse.json(await sendWeeklyDigests());
}
