import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { runAllStrataAutoUpdates } from "@/lib/strata/autoUpdate";

/**
 * Scheduled every 15 minutes (cdk/lib/published-sites-stack.ts): checks Strata for every app
 * that has "Keep my website up to date with Strata" on, and applies safe changes
 * (lib/strata/autoUpdate.ts). Secured like the other internal jobs: the x-cron-secret header
 * must equal CRON_SECRET (compared in constant time), or an admin signs in.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    return NextResponse.json(await runAllStrataAutoUpdates({ concurrency: 4 }));
  } catch (err) {
    console.error("strata-auto-update sweep failed", err);
    return NextResponse.json({ error: "The sweep failed." }, { status: 500 });
  }
}
