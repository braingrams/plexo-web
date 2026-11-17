import { Suspense } from "react";
import { PageContainer } from "../../_components/PageContainer";
import { WordPressMigrationClient } from "./WordPressMigrationClient";
import { getV3SettingsContext } from "@/lib/dashboardV3/settingsContext";
import { getTierFeatures } from "@/lib/subscription";

export const metadata = { title: "Move from WordPress — Plexo" };

export default async function WordPressMigrationPage() {
  // New-look dashboard: the move is drawn with the v3 screens, inside the shell's own frame.
  const ctx = await getV3SettingsContext("/dashboard/migrate/wordpress");
  if (ctx) {
    return (
      <Suspense fallback={null}>
        <WordPressMigrationClient v3 canMove={getTierFeatures(ctx.plan).siteMigrationEnabled} />
      </Suspense>
    );
  }
  return (
    <PageContainer>
      <Suspense fallback={null}>
        <WordPressMigrationClient />
      </Suspense>
    </PageContainer>
  );
}
