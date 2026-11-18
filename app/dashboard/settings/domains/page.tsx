import { redirect } from "next/navigation";
import { getTierFeatures } from "@/lib/subscription";
import { getV3SettingsContext } from "@/lib/dashboardV3/settingsContext";
import { loadAllAddresses } from "@/lib/dashboardV3/domainsData";
import { SettingsPage } from "../../_v3/settings/SettingsPage";
import { DomainsSection } from "../../_v3/settings/DomainsSection";

export const dynamic = "force-dynamic";

export default async function DomainsSettingsPage() {
  const ctx = await getV3SettingsContext("/dashboard/settings/domains");
  if (!ctx) redirect("/dashboard/domains");
  const { sites, addresses } = await loadAllAddresses(ctx.organizationId);
  return (
    <SettingsPage current="domains" experience={ctx.experience}>
      <DomainsSection addresses={addresses} sites={sites} canUseOwn={getTierFeatures(ctx.plan).customDomainEnabled} />
    </SettingsPage>
  );
}
