import { redirect } from "next/navigation";
import { getV3SettingsContext } from "@/lib/dashboardV3/settingsContext";
import { SettingsPage } from "../../_v3/settings/SettingsPage";
import { SettingsPageShell } from "../../_v3/settings/bits";

import { auth } from "@/server/authDynamo";

import { SettingsShell } from "../../_components/SettingsShell";
import { GitHubAccountsClient } from "./GitHubAccountsClient";

export default async function GitHubSettingsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings/github");
  }

  const v3 = await getV3SettingsContext("/dashboard/settings/github");
  if (v3) {
    return (
      <SettingsPage current="developers" experience={v3.experience}>
        <SettingsPageShell title="Code accounts" purpose="Connect the account your own code lives in, so Plexo can publish it for you.">
          <GitHubAccountsClient />
        </SettingsPageShell>
      </SettingsPage>
    );
  }
  return (
    <SettingsShell>
      <GitHubAccountsClient />
    </SettingsShell>
  );
}
