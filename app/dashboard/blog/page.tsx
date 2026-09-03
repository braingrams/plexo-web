import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { Template, BlogSite, PublishedDomain, BlogPost } from "@/lib/db/contentEntities";

import { BlogOverviewClient } from "./BlogOverviewClient";

// Same reasoning as the Templates page: this route sits behind an always-visible nav link
// that Next prefetches proactively, so force-dynamic avoids serving a stale pre-change RSC
// payload right after enabling/creating a blog.
export const dynamic = "force-dynamic";

export default async function BlogOverviewPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/blog");
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  // "Active blogs" = root landing-page templates whose BlogSite.enabled is true. Blog
  // config is always scoped to a site's root Template (parentId: null) — see the comment
  // on Template.blogSite in prisma/schema.prisma. byOrg (GSI1) returns every template in
  // the org, newest-updated first — filtered here in memory for the root/LANDING_PAGE/
  // not-a-layout shape, same "one partition per org" bound this migration uses throughout
  // (an org's own template count is small enough that this isn't a real cost concern).
  const { data: orgTemplates } = await Template.query.byOrg({ organizationId: orgResolution.organizationId }).go({ pages: "all" });
  const candidates = orgTemplates.filter(
    (t) =>
      !t.parentId &&
      t.kind === "LANDING_PAGE" &&
      !t.isBlogLayout &&
      !t.isCommerceLayout &&
      !t.marketplaceStatus,
  );
  // Matches the Prisma version's orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }] —
  // same explicit-sort convention as app/dashboard/templates/page.tsx's identical query.
  candidates.sort((a, b) => {
    const byUpdated = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    if (byUpdated !== 0) return byUpdated;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });

  const [blogSites, domainBatches, postCountBatches] = await Promise.all([
    Promise.all(candidates.map((t) => BlogSite.get({ templateId: t.id }).go())),
    Promise.all(candidates.map((t) => PublishedDomain.query.primary({ templateId: t.id }).go())),
    Promise.all(candidates.map((t) => BlogPost.query.byStatus({ templateId: t.id }).go())),
  ]);

  const blogs: { id: string; name: string; blogTitle: string; postCount: number; updatedAt: string; liveDomain: string | null }[] = [];
  const eligibleTemplates: { id: string; name: string }[] = [];

  candidates.forEach((t, i) => {
    const blogSite = blogSites[i].data;
    if (blogSite?.enabled) {
      const activeDomain = domainBatches[i].data.find((d) => d.active);
      blogs.push({
        id: t.id,
        name: t.name,
        blogTitle: blogSite.title ?? "Blog",
        postCount: postCountBatches[i].data.length,
        updatedAt: t.updatedAt ?? new Date().toISOString(),
        liveDomain: activeDomain?.domain ?? null,
      });
    } else {
      // Templates that could have blogging turned on for them but don't yet — feeds the
      // "New Blog" modal's "Use an existing page" option.
      eligibleTemplates.push({ id: t.id, name: t.name });
    }
  });

  return <BlogOverviewClient blogs={blogs} eligibleTemplates={eligibleTemplates} />;
}
