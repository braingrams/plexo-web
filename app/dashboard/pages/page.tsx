import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";
import { getTierFeatures } from "@/lib/subscription";

import { PagesOverviewClient } from "./PagesOverviewClient";
import { PagesShell } from "../_components/PagesShell";

// Same reasoning as the Templates page: this route sits behind an always-visible nav link
// that Next prefetches proactively, so force-dynamic avoids serving a stale pre-change RSC
// payload right after publishing/adding a sub-page.
export const dynamic = "force-dynamic";

export default async function PagesOverviewPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/pages");
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { subscriptionPlan: true } });
  const isUltra = getTierFeatures(user?.subscriptionPlan).multiPageSitesEnabled;

  // Root landing-page templates with at least one sub-page — i.e. multi-site templates,
  // regardless of whether they've been published to a domain yet. Mirrors the root-template
  // query in app/dashboard/templates/page.tsx; the publishedDomain join below (same pattern
  // as app/dashboard/domains/page.tsx) is only used to show a live link when one exists, not
  // to filter the list.
  const templates = await prisma.template.findMany({
    where: {
      organizationId: orgResolution.organizationId,
      parentId: null,
      kind: "LANDING_PAGE",
      isBlogLayout: false,
      marketplaceStatus: null,
      pages: { some: {} },
      // Same reasoning as /dashboard/templates: a blog-as-homepage site is a blog now,
      // not a landing-page template — keep the two lists consistent.
      NOT: { blogSite: { is: { enabled: true, showOnHomepage: true } } },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      compiledHtml: true,
      updatedAt: true,
      _count: { select: { pages: true } },
      publishedDomains: {
        where: { active: true },
        select: { domain: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return (
    <PagesShell>
      <PagesOverviewClient
        isUltra={isUltra}
        pages={templates.map((t) => ({
          id: t.id,
          name: t.name,
          compiledHtml: t.compiledHtml,
          updatedAt: t.updatedAt.toISOString(),
          pageCount: t._count.pages,
          domains: t.publishedDomains.map((d) => d.domain),
        }))}
      />
    </PagesShell>
  );
}
