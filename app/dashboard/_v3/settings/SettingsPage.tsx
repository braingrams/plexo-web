import { SettingsFrame } from "./SettingsFrame";
import type { SettingsSectionId } from "@/lib/dashboardV3/settingsNav";
import type { Experience } from "@/lib/dashboardV3/nav";

export function SettingsPage({ current, experience, children }: { current: SettingsSectionId; experience: Experience; children: React.ReactNode }) {
  return (
    <SettingsFrame current={current} experience={experience}>
      {children}
    </SettingsFrame>
  );
}
