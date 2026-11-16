import { redirect } from "next/navigation";
import { ApiKey } from "@/lib/db/coreEntities";
import { getV3SettingsContext } from "@/lib/dashboardV3/settingsContext";
import { SettingsPage } from "../../_v3/settings/SettingsPage";
import { ConnectSection } from "../../_v3/settings/ConnectSection";

export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  const ctx = await getV3SettingsContext("/dashboard/settings/connect");
  if (!ctx) redirect("/dashboard/integrations");
  const { data: keys } = await ApiKey.query.primary({ organizationId: ctx.organizationId }).go({ pages: "all" });
  const active = keys.filter((k) => k.isActive).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return (
    <SettingsPage current="connect" experience={ctx.experience}>
      <ConnectSection baseUrl={process.env.NEXT_PUBLIC_APP_URL || "https://plexobuilder.com"} apiKeyHint={active[0]?.maskedKey ?? "your_api_key"} />
    </SettingsPage>
  );
}
