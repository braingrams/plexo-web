import { redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { InsightsClient } from "./insights-client";
import { SettingsShell } from "../_components/SettingsShell";
import { currentUserOnNewDashboard } from "@/lib/dashboardV3/hubRedirect";
import "../commerce/_components/cmx.css";

export default async function InsightsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/insights");
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  // New dashboard: the same page in the new look (it still takes ?templateId= to show one site, and beginners have no Visits tab in the hub).
  const newDashboard = await currentUserOnNewDashboard(session.user.id);
  if (newDashboard) {
    return (
      <div className="plx-page">
        <InsightsClient v3 />
      </div>
    );
  }

  return (
    <SettingsShell>
      <InsightsClient />
    </SettingsShell>
  );
}
