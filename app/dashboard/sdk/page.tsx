import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";
import { SdkClient } from "./sdk-client";
import { SettingsShell } from "../_components/SettingsShell";

export default async function DashboardSdkPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/sdk");
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  // Fetch the org's active API keys to display in the code integration tab
  const apiKeys = await prisma.apiKey.findMany({
    where: {
      organizationId: orgResolution.organizationId,
      isActive: true,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      maskedKey: true,
    },
  });

  return (
    <SettingsShell>
      <SdkClient initialKeys={apiKeys} />
    </SettingsShell>
  );
}
