import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { ImportJobStatus } from "@prisma/client";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { processImportBatch } from "@/lib/blogImport/runBatch";
import { continueImportChain } from "@/lib/blogImport/continueChain";

/**
 * Processes exactly one batch, then — if the job is still healthy and not finished —
 * uses Next's after() to fetch itself again for the next batch. after() is guaranteed to
 * run to completion post-response, unlike a bare non-awaited fetch a serverless runtime
 * could kill mid-flight, which is why this isn't just a plain recursive await (that
 * would tie up one function invocation for the whole import instead of a fresh one per
 * batch, and risks the platform's own execution-time limit on a large site).
 *
 * Same bearer-token pattern as app/api/internal/scan-domains — this is server-to-server
 * only (self-triggered here, or by the stalled-job cron backstop), never called from the
 * browser.
 */
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

  const result = await processImportBatch(body.jobId);

  if (!result.done && result.status === ImportJobStatus.RUNNING) {
    const jobId = body.jobId;
    after(() => continueImportChain(jobId));
  }

  return NextResponse.json({ done: result.done, status: result.status });
}
