import { NextRequest, NextResponse } from "next/server";
import { SiteImportPhase } from "@prisma/client";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { processSiteImportStep } from "@/lib/siteImport/runJob";

// Same in-process, time-boxed loop as app/api/internal/blog-import/process/route.ts — a
// self-triggering HTTP chain trips Vercel's own loop protection (508) after a handful of
// hops, so once the stalled-job cron (resume-stalled/route.ts) reaches a job, this loops in
// process (plain awaited calls, no further HTTP) as far as the time budget allows.
export const maxDuration = 60;
const STEP_LOOP_BUDGET_MS = 50_000;

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  return (!!cronSecret && authHeader === `Bearer ${cronSecret}`) || isAuthorizedAdmin(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { jobId?: string };
  if (!body.jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }

  const deadline = Date.now() + STEP_LOOP_BUDGET_MS;
  let result = await processSiteImportStep(body.jobId);
  while (!result.done && result.phase !== SiteImportPhase.PAUSED_ERROR && Date.now() < deadline) {
    result = await processSiteImportStep(body.jobId);
  }

  return NextResponse.json({ done: result.done, phase: result.phase });
}
