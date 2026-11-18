import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { runAllStrataAutoUpdates } from "@/lib/strata/autoUpdate";
import { runAllSiteBrandSyncs } from "@/lib/brand/siteBrand";

/**
 * Scheduled every 15 minutes (cdk/lib/published-sites-stack.ts): the fallback for a missed
 * Strata webhook. Checks every site with a linked brand and "Keep in sync with Strata" on, of any
 * kind (lib/brand/siteBrand.ts), plus apps that turned on the older per-app switch
 * (lib/strata/autoUpdate.ts), and applies what Strata has PUBLISHED. Secured like the other internal jobs: the x-cron-secret header
 * must equal CRON_SECRET (compared in constant time), or an admin signs in.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    // Sites first (the webhook covers most of them, so this is usually one small request each), sharing the time budget.
    const sites = await runAllSiteBrandSyncs({ concurrency: 4, budgetMs: 2 * 60 * 1000 });
    const apps = await runAllStrataAutoUpdates({ concurrency: 4, budgetMs: 2 * 60 * 1000 });
    return NextResponse.json({ ...apps, sites });
  } catch (err) {
    console.error("strata-auto-update sweep failed", err);
    return NextResponse.json({ error: "The sweep failed." }, { status: 500 });
  }
}
