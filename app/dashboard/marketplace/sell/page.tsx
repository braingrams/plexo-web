import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { Template } from "@/lib/db/contentEntities";
import { PlatformSettings } from "@/lib/db/coreEntities";
import { PageHeader } from "@/app/dashboard/_components/PageHeader";
import { PageContainer } from "@/app/dashboard/_components/PageContainer";
import { SellTemplateForm } from "./SellTemplateForm";

export default async function SellTemplatePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/marketplace/sell");
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  // Only the seller's own working templates (not sub-pages, not existing listing clones)
  // are eligible to become a new listing — same exclusion as the main Templates page.
  const [{ data: orgTemplates }, { data: platformSettings }] = await Promise.all([
    Template.query.byOrg({ organizationId: orgResolution.organizationId }).go({ pages: "all" }),
    PlatformSettings.get({}).go(),
  ]);

  const templates = orgTemplates
    .filter((t) => !t.parentId && !t.marketplaceStatus && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

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
