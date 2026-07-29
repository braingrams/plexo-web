import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { isAuthorizedAdmin } from "@/server/adminAuth";

/**
 * GET /api/internal/domains?filter=flagged|suspended|all
 * Review queue for the abuse-scan pipeline (lib/safeBrowsing.ts) — lists domains that
 * came back positive from a Safe Browsing check so a human can decide whether to
 * suspend them via POST /api/internal/domains/:id/suspend.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const filter = new URL(request.url).searchParams.get("filter") || "flagged";
  const where =
    filter === "suspended" ? { active: false } :
    filter === "all" ? {} :
    { flagged: true, active: true };

  const domains = await prisma.publishedDomain.findMany({
    where,
    include: { user: { select: { email: true } }, template: { select: { name: true } } },
    orderBy: { lastScannedAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ domains });
}
