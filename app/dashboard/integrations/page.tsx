import { redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { ApiKey } from "@/lib/db/coreEntities";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import IntegrationsClient from "./integrations-client";
import { SettingsShell } from "../_components/SettingsShell";

export default async function IntegrationsPage() {
  let session = null;

  try {
    session = await auth();
  } catch (err) {
    console.warn("[integrations] Session retrieval failed, redirecting to login:", err);
    redirect("/auth/login?redirectTo=/dashboard/integrations");
  }

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/integrations");
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  // Fetch the org's active API keys for easy 1-click copying
  const { data: allKeys } = await ApiKey.query.primary({ organizationId: orgResolution.organizationId }).go();
  const apiKeys = allKeys
    .filter((k) => k.isActive)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .map((k) => ({ id: k.id, name: k.name, maskedKey: k.maskedKey, createdAt: k.createdAt ?? new Date().toISOString() }));

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexobuilder.com";

  return (
    <SettingsShell>
      <IntegrationsClient
        user={{
          name: session.user.name ?? "Plexo User",
          email: session.user.email ?? "",
        }}
        apiKeys={apiKeys}
        baseUrl={baseUrl}
      />
    </SettingsShell>
  );
}
