import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";
import { PageHeader } from "@/app/dashboard/_components/PageHeader";
import { PageContainer } from "@/app/dashboard/_components/PageContainer";
import { SellTemplateForm } from "./SellTemplateForm";

export default async function SellTemplatePage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/marketplace/sell");
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  // Only the seller's own working templates (not sub-pages, not existing listing clones)
  // are eligible to become a new listing — same exclusion as the main Templates page.
  const [templates, platformSettings] = await Promise.all([
    prisma.template.findMany({
      where: { organizationId: orgResolution.organizationId, parentId: null, marketplaceStatus: null },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, name: true, kind: true, compiledHtml: true },
    }),
    prisma.platformSettings.findUnique({ where: { id: "global" }, select: { autoPublishMarketplaceListings: true, marketplaceFeeBps: true } }),
  ]);
  const autoPublish = platformSettings?.autoPublishMarketplaceListings ?? false;
  const feeBps = platformSettings?.marketplaceFeeBps ?? 2000;
  const feePercent = (feeBps / 100).toFixed(feeBps % 100 === 0 ? 0 : 2);
  const keepPercent = ((10_000 - feeBps) / 100).toFixed(feeBps % 100 === 0 ? 0 : 2);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Marketplace"
        title="Sell a template"
        subtitle={
          autoPublish
            ? `List one of your own templates for sale — it goes live immediately. Plexo takes a ${feePercent}% fee on each sale, you keep ${keepPercent}%.`
            : `List one of your own templates for sale. An admin reviews it before it goes live. Plexo takes a ${feePercent}% fee on each sale, you keep ${keepPercent}%.`
        }
      />
      <SellTemplateForm
        templates={templates.map((t) => ({ id: t.id, name: t.name, kind: t.kind, hasContent: !!t.compiledHtml.trim() }))}
        autoPublish={autoPublish}
      />
    </PageContainer>
  );
}
