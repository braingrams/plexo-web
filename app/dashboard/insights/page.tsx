import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { headers } from "next/headers";
import { ensureActiveOrganization } from "@/server/org";
import { InsightsClient } from "./insights-client";
import { SettingsShell } from "../_components/SettingsShell";

export default async function InsightsPage() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/insights");
  }

  const orgResolution = await ensureActiveOrganization(reqHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  return (
    <SettingsShell>
      <InsightsClient />
    </SettingsShell>
  );
}
