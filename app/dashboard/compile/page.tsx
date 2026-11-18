import { redirectIfV3 } from "@/lib/dashboardV3/settingsContext";
import React from "react";
import CompileClientPage from "./compile-client";
import { SettingsShell } from "../_components/SettingsShell";

export default async function DashboardCompilePage() {
  await redirectIfV3("/dashboard/compile", "/dashboard/settings/developers");
  return (
    <SettingsShell>
      <CompileClientPage />
    </SettingsShell>
  );
}
