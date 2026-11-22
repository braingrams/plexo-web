import { redirect } from "next/navigation";
import { getV3SettingsContext } from "@/lib/dashboardV3/settingsContext";
import { SettingsPage } from "../../_v3/settings/SettingsPage";
import { SettingsPageShell } from "../../_v3/settings/bits";
import { MigrationHistory } from "../../_v3/settings/MigrationHistory";

export const dynamic = "force-dynamic";
export const metadata = { title: "WordPress moves — Plexo" };

export default async function MigrationSettingsPage() {
  const ctx = await getV3SettingsContext("/dashboard/settings/migration");
  if (!ctx) redirect("/dashboard/migrate/wordpress");
  return (
    <SettingsPage current="migration" experience={ctx.experience}>
      <SettingsPageShell title="WordPress moves" purpose="Every site you've moved from WordPress: when each run happened, what came across and how it ended. Run any of them again if something changed on WordPress.">
        <MigrationHistory />
      </SettingsPageShell>
    </SettingsPage>
  );
}
