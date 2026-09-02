import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { scanPublishedDomain } from "@/lib/safeBrowsing";
import { PublishedDomain } from "@/lib/db/contentEntities";

const BATCH_SIZE = 50;

/**
 * GET /api/internal/scan-domains
 *
 * Periodic re-scan of already-published domains — the on-publish scan (lib/safeBrowsing.ts,
 * triggered from app/api/v1/domains and app/api/v1/publish) only catches threats present
 * at publish time. A page's outbound links can turn malicious later, or Safe Browsing's
 * list can catch up to a URL that was clean when first checked, so this re-checks the
 * least-recently-scanned active domains on every run (see vercel.json's cron entry —
 * daily, the max frequency Vercel Hobby cron plans allow; bump to hourly/6-hourly if
 * the project moves to Pro).
 *
 * PublishedDomain has no index over `active`/`lastScannedAt` (both indexes are keyed off
 * templateId/domain, see contentEntities.ts) — this cross-partition "least recently
 * scanned across every org" access pattern only exists for this once-daily internal job,
 * so a full table Scan (filtered + sorted in application code) is the honest v1 answer
 * here rather than spending a third GSI on the hottest entity in the table for a
 * low-frequency batch job. Revisit via the Athena/export path if this ever needs to run
 * more often than daily.
 *
 * Accepts either Vercel Cron's bearer auth (CRON_SECRET) or the internal admin token,
 * so it can also be triggered manually for testing.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isCronRequest = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCronRequest && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const allActive: { id: string; templateId: string; lastScannedAt?: string }[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { data: { id: string; templateId: string; lastScannedAt?: string }[]; cursor: string | null } =
      await PublishedDomain.scan.where(({ active }, { eq }) => eq(active, true)).go({ cursor });
    allActive.push(...page.data.map((d) => ({ id: d.id, templateId: d.templateId, lastScannedAt: d.lastScannedAt })));
    cursor = page.cursor;
    if (!cursor) break;
  }

  const domains = allActive
    .sort((a, b) => (a.lastScannedAt ?? "").localeCompare(b.lastScannedAt ?? ""))
    .slice(0, BATCH_SIZE);

  const results = await Promise.allSettled(domains.map((d) => scanPublishedDomain(d.templateId, d.id)));
  const failures = results.filter((r) => r.status === "rejected").length;

  return NextResponse.json({ scanned: domains.length, failures });
}
