import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { ApiKey } from "@/lib/db/coreEntities";
import { ensureActiveOrganization } from "@/server/orgDynamo";

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
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings/api-keys");
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const { data: allKeys } = await ApiKey.query.primary({ organizationId: orgResolution.organizationId }).go();
  const apiKeys = allKeys
    .filter((k) => k.isActive)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return (
    <SettingsShell>
      <ApiKeysClient
        initialApiKeys={apiKeys.map((k) => ({
          id: k.id,
          name: k.name,
          maskedKey: k.maskedKey,
          createdAt: k.createdAt ?? new Date().toISOString(),
          isActive: k.isActive ?? true,
        }))}
      />
    </SettingsShell>
  );
}
