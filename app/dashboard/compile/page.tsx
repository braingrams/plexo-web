import React from "react";
import CompileClientPage from "./compile-client";
import { SettingsShell } from "../_components/SettingsShell";

export default function DashboardCompilePage() {
  return (
    <SettingsShell>
      <CompileClientPage />
    </SettingsShell>
  );
}
