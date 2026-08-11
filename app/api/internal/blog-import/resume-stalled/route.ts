import { NextRequest, NextResponse } from "next/server";
import { ImportJobStatus } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { isAuthorizedAdmin } from "@/server/adminAuth";

const STALL_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Backstop for an import whose tab isn't open — normally a job is driven batch-by-batch by
 * the dashboard tab itself (app/dashboard/templates/[id]/blog/import/ImportClient.tsx), so
 * "stalled" here just means nobody's watching, not that anything crashed. Same pattern as
 * app/api/internal/scan-domains: a Vercel Cron entry (see vercel.json) hitting this on a
 * schedule. Each stalled job gets one call to app/api/internal/blog-import/process, which
 * now loops through as many batches as it can in a single invocation (time-boxed, no
 * further HTTP calls) rather than the old self-triggering chain — that pattern tripped
 * Vercel's own loop protection (508) after a handful of hops on anything but a small
 * import. On Hobby's daily-max cron frequency this is a once-a-day catch-up, not a tight
 * polling loop.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isCronRequest = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCronRequest && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const stalledSince = new Date(Date.now() - STALL_THRESHOLD_MS);
  const stalledJobs = await prisma.importJob.findMany({
    where: {
      status: { in: [ImportJobStatus.RUNNING, ImportJobStatus.PAUSED_ERROR] },
      OR: [{ lastHeartbeatAt: { lt: stalledSince } }, { lastHeartbeatAt: null, createdAt: { lt: stalledSince } }],
    },
    select: { id: true },
    take: 20,
  });

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const results = await Promise.allSettled(
    stalledJobs.map((job) =>
      fetch(`${base}/api/internal/blog-import/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cronSecret}` },
        body: JSON.stringify({ jobId: job.id }),
      }),
    ),
  );

  return NextResponse.json({ resumed: stalledJobs.length, failures: results.filter((r) => r.status === "rejected").length });
}
