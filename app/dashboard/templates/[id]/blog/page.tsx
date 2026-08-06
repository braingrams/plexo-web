import { prisma } from "@/server/prisma";
import { requireBlogSiteAccess } from "@/lib/blog/pageAuth";
import { effectiveStatus } from "@/lib/blog/queries";
import { BlogListClient } from "./BlogListClient";

export default async function BlogListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBlogSiteAccess(id, `/dashboard/templates/${id}/blog`);

  const [site, posts] = await Promise.all([
    prisma.blogSite.findUnique({ where: { templateId: access.templateId } }),
    prisma.blogPost.findMany({
      where: { templateId: access.templateId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        publishedAt: true,
        updatedAt: true,
        viewCount: true,
        featuredImageUrl: true,
        author: { select: { name: true } },
      },
    }),
  ]);

  return (
    <BlogListClient
      templateId={access.templateId}
      templateName={access.templateName}
      blogEnabled={site?.enabled ?? false}
      posts={posts.map((p) => ({
        ...p,
        publishedAt: p.publishedAt?.toISOString() ?? null,
        updatedAt: p.updatedAt.toISOString(),
        effectiveStatus: effectiveStatus(p.status, p.publishedAt),
      }))}
    />
  );
}
