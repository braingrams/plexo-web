import { redirect } from "next/navigation";
import { ApiKey } from "@/lib/db/coreEntities";
import { getTierFeatures } from "@/lib/subscription";
import { getV3SettingsContext } from "@/lib/dashboardV3/settingsContext";
import { SettingsPage } from "../../_v3/settings/SettingsPage";
import { DevelopersSection } from "../../_v3/settings/DevelopersSection";

export const dynamic = "force-dynamic";

export default async function DevelopersPage() {
  const ctx = await getV3SettingsContext("/dashboard/settings/developers");
  if (!ctx) redirect("/dashboard/settings/api-keys");
  const features = getTierFeatures(ctx.plan);
  const { data: keys } = await ApiKey.query.primary({ organizationId: ctx.organizationId }).go({ pages: "all" });
  const active = keys.filter((k) => k.isActive).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return (
    <SettingsPage current="developers" experience={ctx.experience}>
      <DevelopersSection
        keys={active.map((k) => ({ id: k.id, name: k.name, maskedKey: k.maskedKey, createdAt: k.createdAt ?? new Date().toISOString() }))}
        maxKeys={features.maxApiKeys}
        canPublishViaApi={features.manageLandingPagePublishingEnabled}
        publishViaApi={ctx.user.manageLandingPagePublishing ?? false}
        canCompile={features.compileApiEnabled}
      />
    </SettingsPage>
  );
}
