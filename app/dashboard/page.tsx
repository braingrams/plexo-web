import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { headers } from "next/headers";
import { ensureActiveOrganization } from "@/server/org";
import { listMarketplaceTemplates } from "@/lib/marketplace";
import { OverviewClient, type NeedsAttentionItem, type ActivityItem, type OverviewTemplateRow } from "./overview-client";
import { OverviewSetup, type StarterTemplate } from "./_components/OverviewSetup";
import { PageContainer } from "./_components/PageContainer";

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

  const templatesCount = await prisma.template.count({
    where: { organizationId, parentId: null, marketplaceStatus: null, isBlogLayout: false, isSiteLayoutFragment: false },
  });

  // Brand-new workspace: skip every other query below and hand off to the guided
  // "pick a template, then publish" setup flow instead of a dashboard full of zeroes.
  if (templatesCount === 0) {
    const { templates } = await listMarketplaceTemplates({ sort: "popular", page: 1 });
    const starterTemplates: StarterTemplate[] = templates.slice(0, 4).map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      category: t.category,
      priceCents: t.priceCents,
    }));

    return (
      <PageContainer>
        <OverviewSetup userName={user.name} starterTemplates={starterTemplates} />
      </PageContainer>
    );
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);
  const fourteenDaysAgo = new Date(sevenDaysAgo);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 7);

  const [
    domainsCount,
    apiKeysCount,
    liveTemplatesCount,
    unverifiedDomains,
    unverifiedDomainsCount,
    unpublishedTemplatesCount,
    unusedApiKeysCount,
    previousViews7d,
    recentTemplateRecords,
    recentDomainActivity,
    recentBlogActivity,
    recentApiKeyActivity,
  ] = await Promise.all([
    prisma.publishedDomain.count({ where: { organizationId } }),
    prisma.apiKey.count({ where: { organizationId } }),
    prisma.template.count({
      where: { organizationId, parentId: null, marketplaceStatus: null, isBlogLayout: false, isSiteLayoutFragment: false, publishedDomains: { some: {} } },
    }),
    prisma.publishedDomain.findMany({
      where: { organizationId, type: "CUSTOM", dnsVerified: false },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: { domain: true },
    }),
    prisma.publishedDomain.count({ where: { organizationId, type: "CUSTOM", dnsVerified: false } }),
    prisma.template.count({
      where: { organizationId, parentId: null, marketplaceStatus: null, isBlogLayout: false, isSiteLayoutFragment: false, publishedDomains: { none: {} } },
    }),
    prisma.apiKey.count({ where: { organizationId, lastUsedAt: null } }),
    prisma.pageView.count({
      where: { template: { organizationId }, createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
    }),
    prisma.template.findMany({
      where: { organizationId, parentId: null, marketplaceStatus: null, isBlogLayout: false, isSiteLayoutFragment: false },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 6,
      select: {
        id: true,
        name: true,
        kind: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { pages: true, publishedDomains: true } },
      },
    }),
    prisma.publishedDomain.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: { domain: true, createdAt: true },
    }),
    prisma.blogPost.findMany({
      where: { template: { organizationId } },
      orderBy: { updatedAt: "desc" },
      take: 2,
      select: { id: true, title: true, status: true, updatedAt: true },
    }),
    prisma.apiKey.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: { name: true, createdAt: true },
    }),
  ]);

  const recentTemplates: OverviewTemplateRow[] = recentTemplateRecords.map((record) => ({
    id: record.id,
    name: record.name,
    kind: record.kind,
    updatedAt: record.updatedAt.toISOString(),
    pageCount: record._count.pages,
    isLive: record._count.publishedDomains > 0,
  }));

  // "Needs attention": only real, derivable signals — an unverified custom domain, a
  // template nobody has connected a domain to yet, an API key that's never been used.
  // Domain verification is surfaced first since it's the most time-sensitive.
  const needsAttention: NeedsAttentionItem[] = [];
  for (const d of unverifiedDomains) {
    if (needsAttention.length >= 3) break;
    needsAttention.push({
      id: `domain-${d.domain}`,
      title: `${d.domain} — DNS not verified`,
      subtitle: "Add the TXT record to finish verification",
      actionLabel: "Verify",
      href: "/dashboard/domains",
      tone: "warning",
    });
  }
  if (needsAttention.length < 3 && unpublishedTemplatesCount > 0) {
    needsAttention.push({
      id: "unpublished-templates",
      title: `${unpublishedTemplatesCount} template${unpublishedTemplatesCount === 1 ? "" : "s"} not yet published`,
      subtitle: "Connect a domain to make them live",
      actionLabel: "Review",
      href: "/dashboard/templates",
      tone: "info",
    });
  }
  if (needsAttention.length < 3 && unusedApiKeysCount > 0) {
    needsAttention.push({
      id: "unused-api-keys",
      title: `${unusedApiKeysCount} API key${unusedApiKeysCount === 1 ? "" : "s"} never used`,
      subtitle: "Remove unused keys or start integrating",
      actionLabel: "Manage",
      href: "/dashboard/settings",
      tone: "warning",
    });
  }

  // Recent activity: merged from the tables that already carry a timestamp — no separate
  // audit-log table exists, so this reads as "what changed recently" rather than a full trail.
  const activityCandidates: ActivityItem[] = [];
  for (const t of recentTemplateRecords) {
    const justCreated = t.updatedAt.getTime() - t.createdAt.getTime() < 10_000;
    activityCandidates.push({
      id: `template-${t.id}`,
      text: justCreated ? `Template "${t.name}" created` : `Template "${t.name}" updated`,
      when: t.updatedAt.toISOString(),
    });
  }
  for (const d of recentDomainActivity) {
    activityCandidates.push({
      id: `domain-activity-${d.domain}`,
      text: `Domain "${d.domain}" connected`,
      when: d.createdAt.toISOString(),
    });
  }
  for (const b of recentBlogActivity) {
    const text =
      b.status === "PUBLISHED" ? `Blog post "${b.title}" published` : b.status === "DRAFT" ? `Blog post "${b.title}" saved as draft` : `Blog post "${b.title}" updated`;
    activityCandidates.push({ id: `blog-${b.id}`, text, when: b.updatedAt.toISOString() });
  }
  for (const k of recentApiKeyActivity) {
    activityCandidates.push({
      id: `apikey-${k.name}-${k.createdAt.toISOString()}`,
      text: `API key "${k.name}" created`,
      when: k.createdAt.toISOString(),
    });
  }
  const recentActivity = activityCandidates.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime()).slice(0, 5);

  return (
    <PageContainer>
      <OverviewClient
        organizationName={orgResolution.organizationName}
        plan={user.subscriptionPlan}
        templatesCount={templatesCount}
        liveTemplatesCount={liveTemplatesCount}
        domainsCount={domainsCount}
        unverifiedDomainsCount={unverifiedDomainsCount}
        apiKeysCount={apiKeysCount}
        previousViews7d={previousViews7d}
        recentTemplates={recentTemplates}
        needsAttention={needsAttention}
        recentActivity={recentActivity}
      />
    </PageContainer>
  );
}
