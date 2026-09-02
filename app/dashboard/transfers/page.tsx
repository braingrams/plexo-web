import { redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { listIncomingTransfers, listOutgoingTransfers } from "@/lib/siteTransferDynamo";
import { Template } from "@/lib/db/contentEntities";
import { Organization, User } from "@/lib/db/coreEntities";
import { SettingsShell } from "../_components/SettingsShell";
import { TransfersListClient } from "./TransfersListClient";

export default async function TransfersPage() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) redirect("/auth/login?redirectTo=/dashboard/transfers");

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") redirect("/choose-org");
  const activeOrgId = orgResolution.organizationId;

  const [incoming, outgoing] = await Promise.all([
    listIncomingTransfers(session.user.email.toLowerCase()),
    listOutgoingTransfers(activeOrgId),
  ]);

  const [incomingTemplates, incomingOrgs, incomingUsers, outgoingTemplates] = await Promise.all([
    Promise.all(incoming.map((t) => Template.get({ id: t.templateId }).go())),
    Promise.all(incoming.map((t) => Organization.get({ id: t.fromOrganizationId }).go())),
    Promise.all(incoming.map((t) => User.get({ id: t.fromUserId }).go())),
    Promise.all(outgoing.map((t) => Template.get({ id: t.templateId }).go())),
  ]);

  return (
    <SettingsShell>
      <TransfersListClient
        incoming={incoming.map((t, i) => ({
          id: t.id,
          siteName: incomingTemplates[i].data?.name ?? "Untitled site",
          fromName: incomingUsers[i].data?.name ?? "Unknown",
          fromOrgName: incomingOrgs[i].data?.name ?? "Unknown organization",
          createdAt: t.createdAt ?? "",
          expiresAt: t.expiresAt,
        }))}
        outgoing={outgoing.map((t, i) => ({
          id: t.id,
          templateId: t.templateId,
          siteName: outgoingTemplates[i].data?.name ?? "Untitled site",
          toEmail: t.toEmail,
          createdAt: t.createdAt ?? "",
        }))}
      />
    </SettingsShell>
  );
}
