import type { headers as NextHeaders } from "next/headers";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

type RequestHeaders = Awaited<ReturnType<typeof NextHeaders>>;

export type ActiveOrgResolution =
  | { status: "resolved"; organizationId: string; organizationName: string; role: string }
  | { status: "needs-choice"; organizations: { id: string; name: string; role: string }[] };

/**
 * Org-scoped login: makes sure the signed-in session always has an active organization
 * before rendering the dashboard, so every server route that reads
 * session.activeOrganizationId sees a consistent value. Mirrors GitHub's "last org you
 * were in" behavior — a user with exactly one membership is dropped straight into it; a
 * user with several is asked to choose (see app/dashboard/choose-org).
 */
export async function ensureActiveOrganization(
  requestHeaders: RequestHeaders,
  userId: string,
): Promise<ActiveOrgResolution> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  const activeOrgId = (session?.session as { activeOrganizationId?: string } | undefined)
    ?.activeOrganizationId;

  const memberships = await prisma.member.findMany({
    where: { userId },
    include: { organization: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (activeOrgId && memberships.some((m) => m.organizationId === activeOrgId)) {
    const active = memberships.find((m) => m.organizationId === activeOrgId)!;
    return {
      status: "resolved",
      organizationId: active.organizationId,
      organizationName: active.organization.name,
      role: active.role,
    };
  }

  if (memberships.length === 0) {
    // Brand-new signup that predates (or slipped past) scripts/backfill-personal-orgs.ts —
    // give them a personal workspace the same way the backfill script does for existing
    // users, so the dashboard never has to handle a "no organization" state.
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const org = await auth.api.createOrganization({
      headers: requestHeaders,
      body: {
        name: `${user?.name ?? "My"}'s Workspace`,
        slug: `ws-${userId.slice(0, 8)}-${Date.now().toString(36)}`,
        userId,
      },
    });
    if (!org) {
      throw new Error("Failed to create a default organization for user " + userId);
    }
    await auth.api.setActiveOrganization({
      headers: requestHeaders,
      body: { organizationId: org.id },
    });
    return { status: "resolved", organizationId: org.id, organizationName: org.name, role: "owner" };
  }

  if (memberships.length === 1) {
    const only = memberships[0];
    await auth.api.setActiveOrganization({
      headers: requestHeaders,
      body: { organizationId: only.organizationId },
    });
    return {
      status: "resolved",
      organizationId: only.organizationId,
      organizationName: only.organization.name,
      role: only.role,
    };
  }

  return {
    status: "needs-choice",
    organizations: memberships.map((m) => ({ id: m.organizationId, name: m.organization.name, role: m.role })),
  };
}
