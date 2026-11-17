import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { Organization } from "@/lib/db/coreEntities";
import { ensureActiveOrganization, getOrganizationOwnerEntitlementDynamo } from "@/server/orgDynamo";
import { getTierFeatures } from "@/lib/subscription";
import { PageHeader } from "@/app/dashboard/_components/PageHeader";
import { SettingsShell } from "@/app/dashboard/_components/SettingsShell";
import { BrandingForm } from "./branding-form";
import { getV3SettingsContext } from "@/lib/dashboardV3/settingsContext";
import { SettingsPage } from "../../_v3/settings/SettingsPage";
import { BrandingSection } from "../../_v3/settings/BrandingSection";

export default async function BrandingSettingsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings/branding");
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const [{ data: org }, workspace] = await Promise.all([
    Organization.get({ id: orgResolution.organizationId }).go(),
    getOrganizationOwnerEntitlementDynamo(orgResolution.organizationId),
  ]);
  if (!org) throw new Error(`Organization ${orgResolution.organizationId} not found`);

  const v3 = await getV3SettingsContext("/dashboard/settings/branding");
  if (v3) {
    return (
      <SettingsPage current="brand" experience={v3.experience}>
        <BrandingSection
          organizationId={orgResolution.organizationId}
          canManage={orgResolution.role === "owner"}
          planAllowsWhiteLabel={getTierFeatures(workspace.subscriptionPlan, { trial: workspace.onTrial }).whiteLabelEnabled}
          initial={{ name: org.name, logo: org.logo ?? "", color: org.brandColor ?? "", mode: (org.brandDisplayMode ?? "BOTH") as "BOTH" | "LOGO_ONLY" | "NAME_ONLY", on: org.whiteLabelEnabled ?? false }}
        />
      </SettingsPage>
    );
  }

  return (
    <SettingsShell>
      <PageHeader
        eyebrow="Organization"
        title="Branding"
        subtitle="Replace the Plexo name, logo, and accent color with your own across the dashboard, published pages, emails, and the embedded builder."
      />
      <BrandingForm
        organizationId={orgResolution.organizationId}
        canManage={orgResolution.role === "owner"}
        planAllowsWhiteLabel={getTierFeatures(workspace.subscriptionPlan, { trial: workspace.onTrial }).whiteLabelEnabled}
        initialWhiteLabelEnabled={org.whiteLabelEnabled ?? false}
        initialName={org.name}
        initialLogo={org.logo ?? null}
        initialBrandColor={org.brandColor ?? null}
        initialBrandDisplayMode={org.brandDisplayMode ?? "BOTH"}
      />
    </SettingsShell>
  );
}
