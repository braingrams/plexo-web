import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { WpMigrationJob } from "@/lib/db/importEntities";

const STALL_THRESHOLD_MS = 3 * 60 * 1000;
// A migration that has made no progress for this long (the source site went offline
// mid-way) is given up on so it stops holding the org's one-active-migration slot. Measured
// from its last step, not its start: a very big site can legitimately take a day or more.
const GIVEUP_THRESHOLD_MS = 72 * 60 * 60 * 1000;
// …and however much progress it's making, nothing should run longer than this.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

/**
 * Scheduled backstop (cdk/lib/published-sites-stack.ts) that keeps a migration moving when
 * the owner closed the dashboard tab driving it — they were told they could, so this runs
 * every 10 minutes rather than daily like the site importer's. PAUSED_ERROR jobs are left for
 * the owner to retry from the dashboard: something went wrong that they may need to look at.
 * Full-table scan filtered in code, same trade-off as site-import's resume-stalled route.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const now = Date.now();
  const stalledBefore = new Date(now - STALL_THRESHOLD_MS).toISOString();
  const giveUpBefore = new Date(now - GIVEUP_THRESHOLD_MS).toISOString();
  const tooOldBefore = new Date(now - MAX_AGE_MS).toISOString();

  type Row = { id: string; templateId: string; phase?: string; createdAt?: string; lastHeartbeatAt?: string };
  const rows: Row[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { data: Row[]; cursor: string | null } = await WpMigrationJob.scan.go({ cursor });
    rows.push(...page.data);
    cursor = page.cursor;
    if (!cursor) break;
  }
  const active = rows.filter((j) => !TERMINAL.has(j.phase ?? "PENDING") && j.phase !== "PAUSED_ERROR");

  const giveUp = active.filter((j) => (j.lastHeartbeatAt ?? j.createdAt ?? "") < giveUpBefore || (j.createdAt ?? "") < tooOldBefore);
  await Promise.all(
    giveUp.map((j) =>
      WpMigrationJob.patch({ templateId: j.templateId, id: j.id }).set({ phase: "FAILED", processing: false, finishedAt: new Date().toISOString() }).go(),
    ),
  );
  const giveUpIds = new Set(giveUp.map((j) => j.id));
  const stalled = active
    .filter((j) => !giveUpIds.has(j.id) && (j.lastHeartbeatAt ?? j.createdAt ?? "") < stalledBefore)
    .slice(0, 10);

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const results = await Promise.allSettled(
    stalled.map((j) =>
      fetch(`${base}/api/internal/wp-migration/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET ?? "" },
        body: JSON.stringify({ jobId: j.id, templateId: j.templateId }),
      }),
    ),
  );
  return NextResponse.json({ resumed: stalled.length, failures: results.filter((r) => r.status === "rejected").length, gaveUp: giveUp.length });
}
