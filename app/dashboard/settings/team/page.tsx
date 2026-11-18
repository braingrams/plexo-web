import { getV3SettingsContext } from "@/lib/dashboardV3/settingsContext";
import { TeamV3 } from "./v3";
import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization, listMembers, listPendingInvitations } from "@/server/orgDynamo";
import { PageHeader } from "@/app/dashboard/_components/PageHeader";
import { SettingsShell } from "@/app/dashboard/_components/SettingsShell";
import { TeamClient } from "./team-client";

export default async function TeamSettingsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings/team");
  }

  const v3 = await getV3SettingsContext("/dashboard/settings/team");
  if (v3) return <TeamV3 ctx={v3} />;

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const [members, invitations] = await Promise.all([
    listMembers(orgResolution.organizationId),
    listPendingInvitations(orgResolution.organizationId),
  ]);

  return (
    <SettingsShell>
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
          id: m.userId,
          userId: m.userId,
          role: m.role,
          scopedTemplateIds: m.scopedTemplateIds,
          name: m.name,
          email: m.email,
        }))}
        initialInvitations={invitations.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          scopedTemplateIds: i.scopedTemplateIds,
          createdAt: i.createdAt,
        }))}
      />
    </SettingsShell>
  );
}
