import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { scanPublishedDomain } from "@/lib/safeBrowsing";

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

  const domains = await prisma.publishedDomain.findMany({
    where: { active: true },
    orderBy: { lastScannedAt: { sort: "asc", nulls: "first" } },
    take: BATCH_SIZE,
    select: { id: true },
  });

  const results = await Promise.allSettled(domains.map((d) => scanPublishedDomain(d.id)));
  const failures = results.filter((r) => r.status === "rejected").length;

  return NextResponse.json({ scanned: domains.length, failures });
}
