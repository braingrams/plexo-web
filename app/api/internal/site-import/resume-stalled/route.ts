import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { SiteImportJob } from "@/lib/db/importEntities";

const STALL_THRESHOLD_MS = 5 * 60 * 1000;
// A job that's been non-terminal for this long despite repeated cron resume attempts is
// presumed permanently stuck (e.g. the source site went offline mid-import) — auto-FAILED
// so it stops holding the org's concurrency slot indefinitely rather than retried forever.
const GIVEUP_THRESHOLD_MS = 48 * 60 * 60 * 1000;

const TERMINAL_PHASES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

/**
 * Same role as app/api/internal/blog-import/resume-stalled/route.ts: an EventBridge
 * schedule backstop (see cdk/lib/published-sites-stack.ts's own comment) for a job whose
 * tab isn't open, since a site-import job is normally driven batch-by-batch by the
 * dashboard tab itself. Once a day is the right cadence — this is a catch-up backstop, not
 * a tight polling loop.
 *
 * SiteImportJob has no index over phase (only primary/byOrg, see importEntities.ts) — this
 * cross-org "every non-terminal job" sweep only exists for this once-daily internal job,
 * so a full table Scan (filtered in application code, same as app/api/internal/
 * scan-domains's PublishedDomain scan) is the honest v1 answer rather than a third GSI on
 * this entity for a low-frequency batch job.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const now = Date.now();
  const stalledSince = new Date(now - STALL_THRESHOLD_MS).toISOString();
  const giveUpBefore = new Date(now - GIVEUP_THRESHOLD_MS).toISOString();

  type JobRow = { id: string; templateId: string; phase?: string; createdAt?: string; lastHeartbeatAt?: string };
  const allJobs: JobRow[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { data: JobRow[]; cursor: string | null } = await SiteImportJob.scan.go({ cursor });
    allJobs.push(...page.data);
    cursor = page.cursor;
    if (!cursor) break;
  }

  const nonTerminal = allJobs.filter((j) => !TERMINAL_PHASES.has(j.phase ?? "PENDING"));

  const giveUpJobs = nonTerminal.filter((j) => (j.createdAt ?? "") < giveUpBefore);
  await Promise.all(
    giveUpJobs.map((j) =>
      SiteImportJob.patch({ templateId: j.templateId, id: j.id })
        .set({ phase: "FAILED" as any, processing: false, finishedAt: new Date().toISOString() })
        .go(),
    ),
  );
  const giveUpIds = new Set(giveUpJobs.map((j) => j.id));

  const stalledJobs = nonTerminal
    .filter((j) => !giveUpIds.has(j.id) && ((j.lastHeartbeatAt && j.lastHeartbeatAt < stalledSince) || (!j.lastHeartbeatAt && (j.createdAt ?? "") < stalledSince)))
    .slice(0, 20);

  // x-cron-secret, NOT Authorization — see lib/cronAuth.ts's own comment: a Lambda
  // Function URL intercepts any request carrying an Authorization header and rejects it
  // as an invalid SigV4 signature attempt before this app's own code ever runs, even for
  // a same-app self-call like this one.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const results = await Promise.allSettled(
    stalledJobs.map((job) =>
      fetch(`${base}/api/internal/site-import/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET ?? "" },
        body: JSON.stringify({ jobId: job.id, templateId: job.templateId }),
      }),
    ),
  );

  return NextResponse.json({ resumed: stalledJobs.length, failures: results.filter((r) => r.status === "rejected").length, gaveUp: giveUpJobs.length });
}
