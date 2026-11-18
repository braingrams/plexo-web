import { notFound } from "next/navigation";
import { SettingsPreview } from "../SettingsPreview";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "@/lib/dashboardV3/settingsNav";

/** DEV ONLY: one Settings section with fake data. */
export default async function V3PreviewSettingsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { section } = await params;
  if (!(section in SETTINGS_SECTIONS)) notFound();
  return <SettingsPreview section={section as SettingsSectionId} />;
}
