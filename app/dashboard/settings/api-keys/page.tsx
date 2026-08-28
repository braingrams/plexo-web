import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";

import { ApiKeysClient } from "./ApiKeysClient";
import { SettingsShell } from "../../_components/SettingsShell";

export type SettingsApiKey = {
  id: string;
  name: string;
  maskedKey: string;
  createdAt: string;
  isActive: boolean;
};

export default async function ApiKeysPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings/api-keys");
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const apiKeys = await prisma.apiKey.findMany({
    where: { organizationId: orgResolution.organizationId, isActive: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, maskedKey: true, createdAt: true, isActive: true },
  });

  return (
    <SettingsShell>
      <ApiKeysClient
        initialApiKeys={apiKeys.map((k) => ({ ...k, createdAt: k.createdAt.toISOString() }))}
      />
    </SettingsShell>
  );
}
