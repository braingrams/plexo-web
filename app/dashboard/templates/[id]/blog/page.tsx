import { BlogSite, BlogPost, BlogAuthor } from "@/lib/db/contentEntities";
import { requireBlogSiteAccess } from "@/lib/blog/pageAuthDynamo";
import { effectiveStatus } from "@/lib/blog/queriesDynamo";
import { getPublishedBlogPostQuotaStatus } from "@/lib/blog/publishQuota";
import { BlogListClient } from "./BlogListClient";

export default async function BlogListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const access = await requireBlogSiteAccess(
    id,
    `/dashboard/templates/${id}/blog`,
  );

  const [{ data: site }, { data: posts }, { data: authors }, quota] =
    await Promise.all([
      BlogSite.get({ templateId: access.templateId }).go(),
      // byStatus's SK starts with status, so a plain query doesn't give "every post sorted
      // by updatedAt" directly — fetch the partition (byStatus's PK is already
      // templateId-scoped) and sort in memory.
      BlogPost.query.byStatus({ templateId: access.templateId }).go(),
      // No byId index on BlogAuthor (slug is its SK) — small per-site set, fetch all and
      // build a lookup map.
      BlogAuthor.query.primary({ templateId: access.templateId }).go(),
      getPublishedBlogPostQuotaStatus(
        access.templateId,
        access.subscriptionPlan,
      ),
    ]);
  const authorNameById = new Map(authors.map((a) => [a.id, a.name]));

  const sortedPosts = [...posts].sort((a, b) =>
    (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  );

  return (
    <BlogListClient
      templateId={access.templateId}
      templateName={access.templateName}
      blogEnabled={site?.enabled ?? false}
      publishedCount={quota.count}
      publishedLimit={quota.limit}
      plan={quota.plan}
      posts={sortedPosts.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        status: p.status ?? "DRAFT",
        viewCount: p.viewCount ?? 0,
        featuredImageUrl: p.featuredImageUrl ?? null,
        author: { name: (p.authorId && authorNameById.get(p.authorId)) ?? "" },
        publishedAt: p.publishedAt ?? null,
        updatedAt: p.updatedAt ?? new Date().toISOString(),
        effectiveStatus: effectiveStatus(
          p.status ?? "DRAFT",
          p.publishedAt ?? null,
        ) as "DRAFT" | "PUBLISHED" | "SCHEDULED" | "ARCHIVED",
      }))}
    />
  );
}
