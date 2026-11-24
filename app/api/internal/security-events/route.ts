import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { listRecentSecurityEvents } from "@/lib/security/events";

/**
 * GET /api/internal/security-events?days=1
 *
 * Staff only (admin sign-in or the cron secret). The recent security trail: floods of sign-up or reset attempts that hit a limit,
 * requests blocked from reaching an internal address, form bots caught. Newest first, at most 7 days, nothing sensitive stored.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const days = Number(new URL(request.url).searchParams.get("days") ?? "1");
  const events = await listRecentSecurityEvents(Number.isFinite(days) ? days : 1);
  const counts = events.reduce<Record<string, number>>((n, e) => ((n[e.type] = (n[e.type] ?? 0) + 1), n), {});
  return NextResponse.json({ counts, events });
}
