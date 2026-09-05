import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { Template, BlogSite } from "@/lib/db/contentEntities";
import { ensureActiveOrganization } from "@/server/orgDynamo";

import { TemplatesClient } from "./templates-client";
import { PagesShell } from "../_components/PagesShell";

// Always fetch fresh — this route sits behind the always-visible "Templates" nav link, which
// Next prefetches proactively. Without this, navigating back here after creating/editing a
// template (e.g. the editor's "← Templates" button) can serve a stale pre-change RSC payload
// from that prefetch instead of the current list.
export const dynamic = "force-dynamic";

type TemplateKind = "EMAIL" | "LANDING_PAGE";

type TemplateSummary = {
  id: string;
  name: string;
  kind: TemplateKind;
  compiledHtml: string;
  createdAt: string;
  updatedAt: string;
  pageCount: number;
  isLmsFunnel: boolean;
};

export default async function TemplatesDashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/templates");
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  // Sub-pages (parentId set) live inside their parent's editor, not as separate top-level
  // entries here. Marketplace listing clones (marketplaceStatus set) live in
  // /dashboard/marketplace/listings instead — see app/api/templates/route.ts's identical
  // filter for why.
  const { data: all } = await Template.query.byOrg({ organizationId: orgResolution.organizationId }).go({ pages: "all" });
  const candidates = all.filter(
    (t) => !t.parentId && !t.marketplaceStatus && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout && !t.isLmsPageDesign,
  );

  // A site whose blog is set as its homepage is conceptually a blog now, not a
  // landing-page template — it still shows in /dashboard/blog, just not here.
  const blogSites = await Promise.all(candidates.map((t) => BlogSite.get({ templateId: t.id }).go()));
  const roots = candidates.filter((t, i) => {
    const site = blogSites[i].data;
    return !(site?.enabled && site?.showOnHomepage);
  });

  roots.sort((a, b) => {
    const byUpdated = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    if (byUpdated !== 0) return byUpdated;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });

  const templates: TemplateSummary[] = await Promise.all(
    roots.map(async (t) => {
      const { data: children } = await Template.query.byParent({ parentId: t.id }).go();
      return {
        id: t.id,
        name: t.name,
        kind: t.kind as TemplateKind,
        compiledHtml: t.compiledHtml,
        createdAt: t.createdAt ?? new Date().toISOString(),
        updatedAt: t.updatedAt ?? new Date().toISOString(),
        pageCount: children.length,
        isLmsFunnel: t.isLmsFunnel ?? false,
      };
    }),
  );

  return (
    <PagesShell>
      <TemplatesClient initialTemplates={templates} />
    </PagesShell>
  );
}
