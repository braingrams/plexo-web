import { redirectIfV3 } from "@/lib/dashboardV3/settingsContext";
import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { ApiKey, User } from "@/lib/db/coreEntities";
import { ensureActiveOrganization, getOrganizationOwnerEntitlementDynamo } from "@/server/orgDynamo";
import { getTierFeatures } from "@/lib/subscription";
import { SdkClient } from "./sdk-client";
import { SettingsShell } from "../_components/SettingsShell";

export default async function DashboardSdkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await redirectIfV3("sdk/page.tsx", "/dashboard/settings/developers", await searchParams);
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/sdk");
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  // Fetch the org's active API keys to display in the code integration tab
  const [{ data: allKeys }, { data: user }] = await Promise.all([
    ApiKey.query.primary({ organizationId: orgResolution.organizationId }).go({ pages: "all" }),
    User.get({ id: session.user.id }).go(),
  ]);
  if (!user) throw new Error(`Session user ${session.user.id} has no matching User record`);
  const apiKeys = allKeys
    .filter((k) => k.isActive)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .map((k) => ({ id: k.id, name: k.name, maskedKey: k.maskedKey }));

  return (
    <SettingsShell>
      <SdkClient
        initialKeys={apiKeys}
        initialManageLandingPagePublishing={user.manageLandingPagePublishing ?? false}
        canSelfManagePublishing={getTierFeatures((await getOrganizationOwnerEntitlementDynamo(orgResolution.organizationId)).subscriptionPlan).manageLandingPagePublishingEnabled}
      />
    </SettingsShell>
  );
}
