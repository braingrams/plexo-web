import { listMembers, listPendingInvitations } from "@/server/orgDynamo";
import { SettingsPage } from "../../_v3/settings/SettingsPage";
import { TeamSection } from "../../_v3/settings/TeamSection";
import { getTierFeatures } from "@/lib/subscription";
import { loadV3Sites } from "@/lib/dashboardV3/loadShell";
import type { SettingsContext } from "@/lib/dashboardV3/settingsContext";

export async function TeamV3({ ctx }: { ctx: SettingsContext }) {
  const [members, invitations, sites] = await Promise.all([listMembers(ctx.organizationId), listPendingInvitations(ctx.organizationId), loadV3Sites(ctx.organizationId, ctx.userId).catch(() => [])]);
  return (
    <SettingsPage current="team" experience={ctx.experience}>
      <TeamSection
        currentUserId={ctx.userId}
        currentRole={ctx.role}
        organizationName={ctx.organizationName}
        sites={sites.map((s) => ({ id: s.id, name: s.name }))}
        seatLimit={getTierFeatures(ctx.plan).teamSeats}
        members={members.map((m) => ({ id: m.userId, userId: m.userId, role: m.role, scopedTemplateIds: m.scopedTemplateIds, siteAccess: m.siteAccess, name: m.name, email: m.email }))}
        invitations={invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, scopedTemplateIds: i.scopedTemplateIds, siteAccess: i.siteAccess, createdAt: i.createdAt }))}
      />
    </SettingsPage>
  );
}
