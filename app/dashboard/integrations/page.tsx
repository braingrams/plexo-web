import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";
import IntegrationsClient from "./integrations-client";
import { SettingsShell } from "../_components/SettingsShell";

export default async function IntegrationsPage() {
  const reqHeaders = await headers();
  let session = null;
  
  try {
    session = await auth.api.getSession({ headers: reqHeaders });
  } catch (err) {
    console.warn("[integrations] Session retrieval failed, redirecting to login:", err);
    redirect("/auth/login?redirectTo=/dashboard/integrations");
  }

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/integrations");
  }

  const orgResolution = await ensureActiveOrganization(reqHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  // Fetch the org's active API keys for easy 1-click copying
  const apiKeys = await prisma.apiKey.findMany({
    where: { organizationId: orgResolution.organizationId, isActive: true },
    select: { id: true, name: true, maskedKey: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexobuilder.com";

  return (
    <SettingsShell>
      <IntegrationsClient
        user={{
          name: session.user.name ?? "Plexo User",
          email: session.user.email,
        }}
        apiKeys={apiKeys}
        baseUrl={baseUrl}
      />
    </SettingsShell>
  );
}
