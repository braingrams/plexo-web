import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { processImportBatch } from "@/lib/blogImport/runBatchDynamo";

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
  return isCronRequest(request) || isAuthorizedAdmin(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // templateId is required now — ImportJob's primary key is (templateId, id), see
  // runBatchDynamo.ts's own comment. The only caller (resume-stalled/route.ts) already
  // has it from its own ImportJob.byStatus query result.
  const body = (await request.json().catch(() => ({}))) as { jobId?: string; templateId?: string };
  if (!body.jobId || !body.templateId) {
    return NextResponse.json({ error: "jobId and templateId are required." }, { status: 400 });
  }

  const deadline = Date.now() + BATCH_LOOP_BUDGET_MS;
  let result = await processImportBatch(body.templateId, body.jobId);
  while (!result.done && result.status === "RUNNING" && Date.now() < deadline) {
    result = await processImportBatch(body.templateId, body.jobId);
  }

  return NextResponse.json({ done: result.done, status: result.status });
}
