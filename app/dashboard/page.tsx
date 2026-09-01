import { redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { ApiKey } from "@/lib/db/coreEntities";
import { Template, PublishedDomain, BlogPost } from "@/lib/db/contentEntities";
import { PageView } from "@/lib/db/opsEntities";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { listMarketplaceTemplates } from "@/lib/marketplace";
import { OverviewClient, type NeedsAttentionItem, type ActivityItem, type OverviewTemplateRow } from "./overview-client";
import { OverviewSetup, type StarterTemplate } from "./_components/OverviewSetup";
import { PageContainer } from "./_components/PageContainer";

export default async function OverviewPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login");
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }
  const organizationId = orgResolution.organizationId;

  const { data: user } = await User.get({ id: session.user.id }).go();

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

  const { data: allTemplates } = await Template.query.byOrg({ organizationId }).go();
  const rootTemplates = allTemplates.filter(
    (t) => !t.parentId && !t.marketplaceStatus && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout,
  );
  const templatesCount = rootTemplates.length;

  // Brand-new workspace: skip every other query below and hand off to the guided
  // "pick a template, then publish" setup flow instead of a dashboard full of zeroes.
  // listMarketplaceTemplates is still Prisma-backed (marketplace browsing hasn't cut
  // over yet) — a separate, lower-traffic concern from this page's own org-scoped data.
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
        <OverviewSetup userName={user.name ?? "there"} starterTemplates={starterTemplates} />
      </PageContainer>
    );
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);
  const fourteenDaysAgo = new Date(sevenDaysAgo);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 7);
  const sevenDaysAgoIso = sevenDaysAgo.toISOString();
  const fourteenDaysAgoIso = fourteenDaysAgo.toISOString();

  // PublishedDomain/BlogPost/PageView have no org-wide index — each is scoped by
  // templateId (see their own entity comments), so this fans out per root template and
  // aggregates in memory. Bounded by how many sites one org actually has (small in
  // practice, same assumption used throughout this migration), not by total row count.
  const [domainsByTemplate, blogPostsByTemplate, viewCountsByTemplate, apiKeysResult] = await Promise.all([
    Promise.all(rootTemplates.map((t) => PublishedDomain.query.primary({ templateId: t.id }).go())),
    Promise.all(rootTemplates.map((t) => BlogPost.query.primary({ templateId: t.id }).go())),
    Promise.all(
      rootTemplates.map((t) =>
        PageView.query
          .primary({ templateId: t.id })
          .between({ createdAt: fourteenDaysAgoIso }, { createdAt: sevenDaysAgoIso })
          .go({ pages: "all" }),
      ),
    ),
    ApiKey.query.primary({ organizationId }).go(),
  ]);
  const apiKeys = apiKeysResult.data;

  const allDomains = domainsByTemplate.flatMap((d) => d.data);
  const domainsCount = allDomains.length;
  const apiKeysCount = apiKeys.length;
  const liveTemplatesCount = rootTemplates.filter((_, i) => domainsByTemplate[i].data.length > 0).length;
  const unpublishedTemplatesCount = rootTemplates.filter((_, i) => domainsByTemplate[i].data.length === 0).length;
  const unusedApiKeysCount = apiKeys.filter((k) => !k.lastUsedAt).length;
  const previousViews7d = viewCountsByTemplate.reduce((sum, r) => sum + r.data.length, 0);

  const unverifiedDomains = allDomains
    .filter((d) => d.type === "CUSTOM" && !d.dnsVerified)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 2);
  const unverifiedDomainsCount = allDomains.filter((d) => d.type === "CUSTOM" && !d.dnsVerified).length;

  const recentTemplateRecords = [...rootTemplates]
    .sort((a, b) => {
      const byUpdated = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
      if (byUpdated !== 0) return byUpdated;
      return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    })
    .slice(0, 6);
  const recentTemplatePageCounts = await Promise.all(
    recentTemplateRecords.map((t) => Template.query.byParent({ parentId: t.id }).go()),
  );

  const recentDomainActivity = [...allDomains]
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 2);

  const recentBlogActivity = blogPostsByTemplate
    .flatMap((b) => b.data)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, 2);

  const recentApiKeyActivity = [...apiKeys]
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 2);

  const recentTemplates: OverviewTemplateRow[] = recentTemplateRecords.map((record, i) => {
    const idx = rootTemplates.findIndex((t) => t.id === record.id);
    return {
      id: record.id,
      name: record.name,
      kind: record.kind,
      updatedAt: record.updatedAt ?? new Date().toISOString(),
      pageCount: recentTemplatePageCounts[i].data.length,
      isLive: domainsByTemplate[idx]?.data.length > 0,
    };
  });

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
      href: "/dashboard/settings/api-keys",
      tone: "warning",
    });
  }

  // Recent activity: merged from the tables that already carry a timestamp — no separate
  // audit-log table exists, so this reads as "what changed recently" rather than a full trail.
  const activityCandidates: ActivityItem[] = [];
  for (const t of recentTemplateRecords) {
    const createdAt = t.createdAt ?? new Date().toISOString();
    const updatedAt = t.updatedAt ?? createdAt;
    const justCreated = new Date(updatedAt).getTime() - new Date(createdAt).getTime() < 10_000;
    activityCandidates.push({
      id: `template-${t.id}`,
      text: justCreated ? `Template "${t.name}" created` : `Template "${t.name}" updated`,
      when: updatedAt,
    });
  }
  for (const d of recentDomainActivity) {
    activityCandidates.push({
      id: `domain-activity-${d.domain}`,
      text: `Domain "${d.domain}" connected`,
      when: d.createdAt ?? new Date().toISOString(),
    });
  }
  for (const b of recentBlogActivity) {
    const text =
      b.status === "PUBLISHED" ? `Blog post "${b.title}" published` : b.status === "DRAFT" ? `Blog post "${b.title}" saved as draft` : `Blog post "${b.title}" updated`;
    activityCandidates.push({ id: `blog-${b.id}`, text, when: b.updatedAt ?? new Date().toISOString() });
  }
  for (const k of recentApiKeyActivity) {
    activityCandidates.push({
      id: `apikey-${k.name}-${k.createdAt}`,
      text: `API key "${k.name}" created`,
      when: k.createdAt ?? new Date().toISOString(),
    });
  }
  const recentActivity = activityCandidates.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime()).slice(0, 5);

  return (
    <PageContainer>
      <OverviewClient
        organizationName={orgResolution.organizationName}
        plan={user.subscriptionPlan ?? "FREE"}
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
