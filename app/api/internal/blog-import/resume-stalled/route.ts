import { NextRequest, NextResponse } from "next/server";
import { ImportJob } from "@/lib/db/importEntities";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";

const STALL_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Backstop for an import whose tab isn't open — normally a job is driven batch-by-batch by
 * the dashboard tab itself (app/dashboard/templates/[id]/blog/import/ImportClient.tsx), so
 * "stalled" here just means nobody's watching, not that anything crashed. Same pattern as
 * app/api/internal/scan-domains: an EventBridge schedule (see
 * cdk/lib/published-sites-stack.ts's own comment) hitting this once a day. Each stalled job
 * gets one call to app/api/internal/blog-import/process, which loops through as many
 * batches as it can in a single invocation (time-boxed, no further HTTP calls) rather than
 * a self-triggering chain — that pattern tripped Vercel's own loop protection (508) after a
 * handful of hops on anything but a small import, back when this ran on Vercel Cron. Once a
 * day is still the right cadence now — this is a catch-up backstop, not a tight polling loop.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const stalledSince = new Date(Date.now() - STALL_THRESHOLD_MS).toISOString();

  // byStatus's PK is a single status value — DynamoDB has no "status IN (...)" query, so
  // this issues one query per status and merges, unlike Prisma's single findMany.
  const [{ data: running }, { data: pausedError }] = await Promise.all([
    ImportJob.query.byStatus({ status: "RUNNING" }).go(),
    ImportJob.query.byStatus({ status: "PAUSED_ERROR" }).go(),
  ]);
  const stalledJobs = [...running, ...pausedError]
    .filter((job) => {
      if (job.lastHeartbeatAt) return job.lastHeartbeatAt < stalledSince;
      return (job.createdAt ?? "") < stalledSince;
    })
    .slice(0, 20);

  // x-cron-secret, NOT Authorization — see lib/cronAuth.ts's own comment: a Lambda
  // Function URL intercepts any request carrying an Authorization header and rejects it
  // as an invalid SigV4 signature attempt before this app's own code ever runs, even for
  // a same-app self-call like this one.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const results = await Promise.allSettled(
    stalledJobs.map((job) =>
      fetch(`${base}/api/internal/blog-import/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET ?? "" },
        body: JSON.stringify({ jobId: job.id, templateId: job.templateId }),
      }),
    ),
  );

  return NextResponse.json({ resumed: stalledJobs.length, failures: results.filter((r) => r.status === "rejected").length });
}
