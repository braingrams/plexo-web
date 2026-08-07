import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";
import { PageHeader } from "@/app/dashboard/_components/PageHeader";
import { PageContainer } from "@/app/dashboard/_components/PageContainer";
import { TeamClient } from "./team-client";

export default async function TeamSettingsPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings/team");
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const [members, invitations] = await Promise.all([
    prisma.member.findMany({
      where: { organizationId: orgResolution.organizationId },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invitation.findMany({
      where: { organizationId: orgResolution.organizationId, status: "pending" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Organization"
        title="Team"
        subtitle={`Manage who can access ${orgResolution.organizationName} and what they're allowed to do.`}
      />
      <TeamClient
        currentUserId={session.user.id}
        currentRole={orgResolution.role}
        organizationName={orgResolution.organizationName}
        initialMembers={members.map((m) => ({
          id: m.id,
          userId: m.userId,
          role: m.role,
          name: m.user.name,
          email: m.user.email,
        }))}
        initialInvitations={invitations.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          createdAt: i.createdAt.toISOString(),
        }))}
      />
    </PageContainer>
  );
}
