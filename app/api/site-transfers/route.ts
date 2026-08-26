import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

/** Every pending transfer touching the signed-in user — incoming (sent to their email)
 * and outgoing (sent from their active org) — for the /dashboard/transfers list. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const activeOrgId = (session.session as { activeOrganizationId?: string } | undefined)?.activeOrganizationId;

  const [incoming, outgoing] = await Promise.all([
    prisma.siteTransferRequest.findMany({
      where: { toEmail: session.user.email.toLowerCase(), status: "PENDING" },
      include: { template: { select: { id: true, name: true } }, fromOrganization: { select: { name: true } }, fromUser: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    }),
    activeOrgId
      ? prisma.siteTransferRequest.findMany({
          where: { fromOrganizationId: activeOrgId, status: "PENDING" },
          include: { template: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  return NextResponse.json({ incoming, outgoing });
}
