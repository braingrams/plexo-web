import { redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { InsightsClient } from "./insights-client";
import { SettingsShell } from "../_components/SettingsShell";

export default async function InsightsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/insights");
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  return (
    <SettingsShell>
      <InsightsClient />
    </SettingsShell>
  );
}
