import { NextRequest, NextResponse } from "next/server";
import { ImportJobStatus } from "@prisma/client";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { processImportBatch } from "@/lib/blogImport/runBatch";

// Import jobs normally progress via the dashboard tab driving batches one at a time
// (app/dashboard/templates/[id]/blog/import/ImportClient.tsx) — this route is now only
// reached by the once-a-day stalled-job cron (resume-stalled/route.ts), for jobs whose tab
// isn't open. A self-triggering HTTP chain used to drive this instead, but a function
// repeatedly calling itself over HTTP tripped Vercel's loop protection (508) after a
// handful of hops on any import bigger than a couple dozen posts. Looping in-process here
// (plain awaited calls, no further HTTP) makes real progress once triggered without ever
// looking like a request loop to that protection.
export const maxDuration = 60;
const BATCH_LOOP_BUDGET_MS = 50_000;

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

  const deadline = Date.now() + BATCH_LOOP_BUDGET_MS;
  let result = await processImportBatch(body.jobId);
  while (!result.done && result.status === ImportJobStatus.RUNNING && Date.now() < deadline) {
    result = await processImportBatch(body.jobId);
  }

  return NextResponse.json({ done: result.done, status: result.status });
}
