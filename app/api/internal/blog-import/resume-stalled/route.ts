import { NextRequest, NextResponse } from "next/server";
import { ImportJobStatus } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { isAuthorizedAdmin } from "@/server/adminAuth";

const STALL_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Backstop for a self-triggering batch chain (app/api/internal/blog-import/process) that
 * died mid-flight — a crashed invocation, a dropped after() continuation, or a
 * transient error that paused the job. Same pattern as app/api/internal/scan-domains:
 * a Vercel Cron entry (see vercel.json) hitting this on a schedule. On Hobby's daily-max
 * cron frequency this is a once-a-day safety net, not the primary continuation
 * mechanism — after() resuming itself immediately is what makes an import feel instant
 * in the common case where nothing crashes.
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
