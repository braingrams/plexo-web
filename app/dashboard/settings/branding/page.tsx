import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { Organization } from "@/lib/db/coreEntities";
import { ensureActiveOrganization, getOrganizationOwnerPlanDynamo } from "@/server/orgDynamo";
import { canWhiteLabel } from "@/lib/subscription";
import { PageHeader } from "@/app/dashboard/_components/PageHeader";
import { PageContainer } from "@/app/dashboard/_components/PageContainer";
import { BrandingForm } from "./branding-form";

export default async function BrandingSettingsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings/branding");
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const [{ data: org }, plan] = await Promise.all([
    Organization.get({ id: orgResolution.organizationId }).go(),
    getOrganizationOwnerPlanDynamo(orgResolution.organizationId),
  ]);
  if (!org) throw new Error(`Organization ${orgResolution.organizationId} not found`);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Organization"
        title="Branding"
        subtitle="Replace the Plexo name, logo, and accent color with your own across the dashboard, published pages, emails, and the embedded builder."
      />
      <BrandingForm
        organizationId={orgResolution.organizationId}
        canManage={orgResolution.role === "owner"}
        planAllowsWhiteLabel={canWhiteLabel(plan)}
        initialWhiteLabelEnabled={org.whiteLabelEnabled ?? false}
        initialName={org.name}
        initialLogo={org.logo ?? null}
        initialBrandColor={org.brandColor ?? null}
      />
    </PageContainer>
  );
}
