import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";

import { SettingsClient } from "./settings-client";
import { SettingsShell } from "../_components/SettingsShell";

export default async function DashboardSettingsPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings");
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { subscriptionPlan: true, manageLandingPagePublishing: true },
  });

  return (
    <SettingsShell>
      <SettingsClient
        initialManageLandingPagePublishing={user.manageLandingPagePublishing}
        isUltra={user.subscriptionPlan === "ULTRA"}
      />
    </SettingsShell>
  );
}
