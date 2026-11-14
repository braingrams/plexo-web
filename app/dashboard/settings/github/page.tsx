import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";

import { SettingsShell } from "../../_components/SettingsShell";
import { GitHubAccountsClient } from "./GitHubAccountsClient";

export default async function GitHubSettingsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings/github");
  }

  return (
    <SettingsShell>
      <GitHubAccountsClient />
    </SettingsShell>
  );
}
