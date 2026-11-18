import { redirect } from "next/navigation";
import { listIncomingTransfers, listOutgoingTransfers } from "@/lib/siteTransferDynamo";
import { Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { getTierFeatures } from "@/lib/subscription";
import { getV3SettingsContext } from "@/lib/dashboardV3/settingsContext";
import { loadAllAddresses } from "@/lib/dashboardV3/domainsData";
import { SettingsPage } from "../../_v3/settings/SettingsPage";
import { MovingSection } from "../../_v3/settings/MovingSection";

export const dynamic = "force-dynamic";

export default async function MovingPage() {
  const ctx = await getV3SettingsContext("/dashboard/settings/moving");
  if (!ctx) redirect("/dashboard/transfers");
  const [incoming, outgoing, { sites }] = await Promise.all([listIncomingTransfers(ctx.email.toLowerCase()), listOutgoingTransfers(ctx.organizationId), loadAllAddresses(ctx.organizationId)]);
  const [inT, inU, outT] = await Promise.all([
    Promise.all(incoming.map((t) => Template.get({ id: t.templateId }).go())),
    Promise.all(incoming.map((t) => User.get({ id: t.fromUserId }).go())),
    Promise.all(outgoing.map((t) => Template.get({ id: t.templateId }).go())),
  ]);
  return (
    <SettingsPage current="moving" experience={ctx.experience}>
      <MovingSection
        sites={sites}
        isOwner={ctx.role === "owner"}
        canImport={getTierFeatures(ctx.plan).siteMigrationEnabled}
        incoming={incoming.map((t, i) => ({ id: t.id, siteName: inT[i].data?.name ?? "Untitled site", fromName: inU[i].data?.name ?? "Someone", createdAt: t.createdAt ?? "", expiresAt: t.expiresAt }))}
        outgoing={outgoing.map((t, i) => ({ id: t.id, templateId: t.templateId, siteName: outT[i].data?.name ?? "Untitled site", toEmail: t.toEmail, createdAt: t.createdAt ?? "" }))}
      />
    </SettingsPage>
  );
}
