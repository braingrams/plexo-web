import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { getTierFeatures } from "@/lib/subscription";
import { Template, BlogSite, PublishedDomain } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { sortDomainsPrimaryFirst } from "@/lib/domains/primaryDomain";

import { PagesOverviewClient } from "./PagesOverviewClient";
import { PagesShell } from "../_components/PagesShell";

// Same reasoning as the Templates page: this route sits behind an always-visible nav link
// that Next prefetches proactively, so force-dynamic avoids serving a stale pre-change RSC
// payload right after publishing/adding a sub-page.
export const dynamic = "force-dynamic";

export default async function PagesOverviewPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/pages");
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const { data: user } = await User.get({ id: session.user.id }).go();
  const isUltra = getTierFeatures(user?.subscriptionPlan).multiPageSitesEnabled;

  // Root landing-page templates with at least one sub-page — i.e. multi-site templates,
  // regardless of whether they've been published to a domain yet. Mirrors the root-template
  // query in app/dashboard/templates/page.tsx; the publishedDomain join below (same pattern
  // as app/dashboard/domains/page.tsx) is only used to show a live link when one exists, not
  // to filter the list.
  const { data: all } = await Template.query.byOrg({ organizationId: orgResolution.organizationId }).go({ pages: "all" });
  const candidates = all.filter(
    (t) => !t.parentId && t.kind === "LANDING_PAGE" && !t.marketplaceStatus && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout,
  );

  // Same reasoning as /dashboard/templates: a blog-as-homepage site is a blog now,
  // not a landing-page template — keep the two lists consistent.
  const blogSites = await Promise.all(candidates.map((t) => BlogSite.get({ templateId: t.id }).go()));
  const notBlogHomepages = candidates.filter((t, i) => {
    const site = blogSites[i].data;
    return !(site?.enabled && site?.showOnHomepage);
  });

  const childBatches = await Promise.all(notBlogHomepages.map((t) => Template.query.byParent({ parentId: t.id }).go()));
  const withChildren = notBlogHomepages
    .map((t, i) => ({ template: t, children: childBatches[i].data }))
    .filter((r) => r.children.length > 0);

  withChildren.sort((a, b) => {
    const byUpdated = (b.template.updatedAt ?? "").localeCompare(a.template.updatedAt ?? "");
    if (byUpdated !== 0) return byUpdated;
    return (b.template.createdAt ?? "").localeCompare(a.template.createdAt ?? "");
  });

  const domainBatches = await Promise.all(
    withChildren.map((r) => PublishedDomain.query.primary({ templateId: r.template.id }).where((attr, op) => op.eq(attr.active, true)).go()),
  );

  return (
    <PagesShell>
      <PagesOverviewClient
        isUltra={isUltra}
        pages={withChildren.map((r, i) => ({
          id: r.template.id,
          name: r.template.name,
          compiledHtml: r.template.compiledHtml,
          updatedAt: r.template.updatedAt ?? new Date().toISOString(),
          pageCount: r.children.length,
          domains: sortDomainsPrimaryFirst(domainBatches[i].data).map((d) => d.domain),
        }))}
      />
    </PagesShell>
  );
}
