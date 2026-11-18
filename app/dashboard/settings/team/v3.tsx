import { listMembers, listPendingInvitations } from "@/server/orgDynamo";
import { SettingsPage } from "../../_v3/settings/SettingsPage";
import { TeamSection } from "../../_v3/settings/TeamSection";
import { getTierFeatures } from "@/lib/subscription";
import type { SettingsContext } from "@/lib/dashboardV3/settingsContext";

export async function TeamV3({ ctx }: { ctx: SettingsContext }) {
  const [members, invitations] = await Promise.all([listMembers(ctx.organizationId), listPendingInvitations(ctx.organizationId)]);
  return (
    <SettingsPage current="team" experience={ctx.experience}>
      <TeamSection
        currentUserId={ctx.userId}
        currentRole={ctx.role}
        organizationName={ctx.organizationName}
        seatLimit={getTierFeatures(ctx.plan).teamSeats}
        members={members.map((m) => ({ id: m.userId, userId: m.userId, role: m.role, scopedTemplateIds: m.scopedTemplateIds, name: m.name, email: m.email }))}
        invitations={invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, scopedTemplateIds: i.scopedTemplateIds, createdAt: i.createdAt }))}
      />
    </SettingsPage>
  );
}
