import { redirect } from "next/navigation";
import { getV3SettingsContext } from "@/lib/dashboardV3/settingsContext";
import { SettingsPage } from "../_v3/settings/SettingsPage";
import { ProfileSection } from "../_v3/settings/ProfileSection";

export const dynamic = "force-dynamic";

/** v3 Settings home (You & how Plexo looks). With v3 off, the old profile page is still where settings live. */
export default async function SettingsHomePage() {
  const ctx = await getV3SettingsContext("/dashboard/settings");
  if (!ctx) redirect("/dashboard/profile");
  return (
    <SettingsPage current="profile" experience={ctx.experience}>
      <ProfileSection name={ctx.user.name ?? ""} email={ctx.email} phone={ctx.user.phone ?? null} image={ctx.user.image ?? null} experience={ctx.experience} />
    </SettingsPage>
  );
}
