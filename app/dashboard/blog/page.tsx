import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";

import { BlogOverviewClient } from "./BlogOverviewClient";

// Same reasoning as the Templates page: this route sits behind an always-visible nav link
// that Next prefetches proactively, so force-dynamic avoids serving a stale pre-change RSC
// payload right after enabling/creating a blog.
export const dynamic = "force-dynamic";

export default async function BlogOverviewPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/blog");
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  // "Active blogs" = root landing-page templates whose BlogSite.enabled is true. Blog
  // config is always scoped to a site's root Template (parentId: null) — see the comment
  // on Template.blogSite in prisma/schema.prisma.
  const [templates, eligibleTemplates] = await Promise.all([
    prisma.template.findMany({
      where: {
        organizationId: orgResolution.organizationId,
        parentId: null,
        kind: "LANDING_PAGE",
        isBlogLayout: false, isCommerceLayout: false,
        marketplaceStatus: null,
        blogSite: { is: { enabled: true } },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        updatedAt: true,
        blogSite: { select: { title: true } },
        _count: { select: { blogPosts: true } },
        publishedDomains: {
          where: { active: true },
          select: { domain: true },
          take: 1,
        },
      },
    }),
    // Templates that could have blogging turned on for them but don't yet — feeds the
    // "New Blog" modal's "Use an existing page" option.
    prisma.template.findMany({
      where: {
        organizationId: orgResolution.organizationId,
        parentId: null,
        kind: "LANDING_PAGE",
        isBlogLayout: false, isCommerceLayout: false,
        marketplaceStatus: null,
        NOT: { blogSite: { is: { enabled: true } } },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, name: true },
    }),
  ]);

  return (
    <BlogOverviewClient
      blogs={templates.map((t) => ({
        id: t.id,
        name: t.name,
        blogTitle: t.blogSite?.title ?? "Blog",
        postCount: t._count.blogPosts,
        updatedAt: t.updatedAt.toISOString(),
        liveDomain: t.publishedDomains[0]?.domain ?? null,
      }))}
      eligibleTemplates={eligibleTemplates}
    />
  );
}
