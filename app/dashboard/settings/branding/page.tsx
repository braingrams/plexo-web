import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";
import { canWhiteLabel, getOrganizationOwnerPlan } from "@/lib/subscription";
import { PageHeader } from "@/app/dashboard/_components/PageHeader";
import { PageContainer } from "@/app/dashboard/_components/PageContainer";
import { BrandingForm } from "./branding-form";

export default async function BrandingSettingsPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings/branding");
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const [org, plan] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: orgResolution.organizationId },
      select: { name: true, logo: true, brandColor: true, whiteLabelEnabled: true },
    }),
    getOrganizationOwnerPlan(orgResolution.organizationId),
  ]);

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
        initialWhiteLabelEnabled={org.whiteLabelEnabled}
        initialName={org.name}
        initialLogo={org.logo}
        initialBrandColor={org.brandColor}
      />
    </PageContainer>
  );
}
