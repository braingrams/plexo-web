import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { isAuthorizedAdmin } from "@/server/adminAuth";

/**
 * POST /api/internal/domains/:id/suspend
 * Body: { action: "suspend" | "reinstate", reason?: string }
 *
 * Fast takedown path for an abuse-flagged published domain. Suspending sets
 * PublishedDomain.active=false, which app/pub/[domain] checks before serving any
 * content — visitors get a 403 "unavailable" page instead of the live site, with no
 * need to delete the domain mapping or touch DNS/Vercel domain registration.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const action = body.action === "reinstate" ? "reinstate" : "suspend";

  const record = await prisma.publishedDomain.findUnique({ where: { id } });
  if (!record) {
    return NextResponse.json({ error: "Domain not found." }, { status: 404 });
  }

  const updated = await prisma.publishedDomain.update({
    where: { id },
    data:
      action === "suspend"
        ? {
            active: false,
            suspendedAt: new Date(),
            suspendedReason: typeof body.reason === "string" ? body.reason.slice(0, 500) : "Abuse takedown",
          }
        : { active: true, suspendedAt: null, suspendedReason: null },
  });

  return NextResponse.json({ success: true, domain: updated });
}
