import { NextRequest, NextResponse } from "next/server";
import { SiteImportPhase } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { isAuthorizedAdmin } from "@/server/adminAuth";

const STALL_THRESHOLD_MS = 5 * 60 * 1000;
// A job that's been non-terminal for this long despite repeated cron resume attempts is
// presumed permanently stuck (e.g. the source site went offline mid-import) — auto-FAILED
// so it stops holding the org's concurrency slot indefinitely rather than retried forever.
const GIVEUP_THRESHOLD_MS = 48 * 60 * 60 * 1000;

const TERMINAL_PHASES: SiteImportPhase[] = [SiteImportPhase.COMPLETED, SiteImportPhase.FAILED, SiteImportPhase.CANCELLED];

/**
 * Same role as app/api/internal/blog-import/resume-stalled/route.ts: a Vercel Cron backstop
 * (see vercel.json) for a job whose tab isn't open, since a site-import job is normally driven
 * batch-by-batch by the dashboard tab itself. On Hobby's daily-max cron frequency this is a
 * once-a-day catch-up, not a tight polling loop.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isCronRequest = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCronRequest && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const now = Date.now();
  const stalledSince = new Date(now - STALL_THRESHOLD_MS);

  const giveUp = await prisma.siteImportJob.updateMany({
    where: {
      phase: { notIn: TERMINAL_PHASES },
      createdAt: { lt: new Date(now - GIVEUP_THRESHOLD_MS) },
    },
    data: { phase: SiteImportPhase.FAILED, processing: false, finishedAt: new Date() },
  });

  const stalledJobs = await prisma.siteImportJob.findMany({
    where: {
      phase: { notIn: TERMINAL_PHASES },
      OR: [{ lastHeartbeatAt: { lt: stalledSince } }, { lastHeartbeatAt: null, createdAt: { lt: stalledSince } }],
    },
    select: { id: true },
    take: 20,
  });

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const results = await Promise.allSettled(
    stalledJobs.map((job) =>
      fetch(`${base}/api/internal/site-import/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cronSecret}` },
        body: JSON.stringify({ jobId: job.id }),
      }),
    ),
  );

  return NextResponse.json({ resumed: stalledJobs.length, failures: results.filter((r) => r.status === "rejected").length, gaveUp: giveUp.count });
}
