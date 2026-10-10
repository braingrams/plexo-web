import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { runPlanSweep } from "@/lib/plan/sweep";

export const maxDuration = 60;

/**
 * GET /api/internal/plan-lifecycle
 *
 * Hourly (cdk/lib/published-sites-stack.ts), and once straight after every deploy
 * (.github/workflows/deploy-*.yml) so plan enforcement applies to every account at once
 * rather than as each one is next visited. See lib/plan/sweep.ts.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const report = await runPlanSweep();
  return NextResponse.json(report);
}
