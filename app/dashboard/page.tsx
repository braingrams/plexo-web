import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { headers } from "next/headers";
import { ensureActiveOrganization } from "@/server/org";
import { OverviewClient } from "./overview-client";
import type { TemplateSummary } from "./templates/TemplateCard";

export default async function OverviewPage() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session?.user) {
    redirect("/auth/login");
  }

  const orgResolution = await ensureActiveOrganization(reqHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }
  const organizationId = orgResolution.organizationId;

  // 1. Fetch org-wide onboarding statuses
  const templatesCount = await prisma.template.count({
    where: { organizationId },
  });

  const domainsCount = await prisma.publishedDomain.count({
    where: { organizationId },
  });

  const apiKeysCount = await prisma.apiKey.count({
    where: { organizationId },
  });

  const viewsCount = await prisma.pageView.count({
    where: {
      template: { organizationId },
    },
  });

  // Front-and-center gallery on the overview page — same query/shape (and same
  // marketplaceStatus:null exclusion of listing clones) as app/dashboard/templates/page.tsx,
  // just capped to the most recently-updated few.
  const recentTemplateRecords = await prisma.template.findMany({
    where: { organizationId, parentId: null, marketplaceStatus: null, isBlogLayout: false },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 8,
    select: {
      id: true,
      name: true,
      kind: true,
      compiledHtml: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { pages: true } },
    },
  });
  const recentTemplates: TemplateSummary[] = recentTemplateRecords.map((record) => ({
    id: record.id,
    name: record.name,
    kind: record.kind,
    compiledHtml: record.compiledHtml,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    pageCount: record._count.pages,
  }));

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, subscriptionPlan: true, pendingPlan: true },
  });

  if (!user) {
    redirect("/auth/login");
  }

  // User picked Pro/Ultra at signup but hasn't completed payment yet (subscriptionPlan
  // only flips once the Stripe webhook confirms an active subscription) — a UX nudge,
  // not the real security boundary: every actual entitlement check reads subscriptionPlan
  // directly regardless of whether the user ever passes through this page.
  if (user.pendingPlan && user.pendingPlan !== user.subscriptionPlan) {
    redirect("/auth/complete-subscription");
  }

  return (
    <div style={{ padding: "2rem 8px", maxWidth: 1500, margin: "0 auto" }}>
      <OverviewClient
        userName={user.name}
        plan={user.subscriptionPlan}
        hasTemplates={templatesCount > 0}
        hasDomains={domainsCount > 0}
        hasApiKeys={apiKeysCount > 0}
        hasViews={viewsCount > 0}
        templatesCount={templatesCount}
        domainsCount={domainsCount}
        apiKeysCount={apiKeysCount}
        recentTemplates={recentTemplates}
      />
    </div>
  );
}
