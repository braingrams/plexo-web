import { prisma } from "@/server/prisma";
import { requireBlogSiteAccess } from "@/lib/blog/pageAuth";
import { BlogPostEditor } from "../BlogPostEditor";

export default async function NewBlogPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBlogSiteAccess(id, `/dashboard/templates/${id}/blog/new`);

  const [categories, tags, authors, domain] = await Promise.all([
    prisma.blogCategory.findMany({ where: { templateId: access.templateId }, orderBy: { name: "asc" } }),
    prisma.blogTag.findMany({ where: { templateId: access.templateId }, orderBy: { name: "asc" } }),
    prisma.blogAuthor.findMany({ where: { templateId: access.templateId }, orderBy: { name: "asc" } }),
    prisma.publishedDomain.findFirst({ where: { templateId: access.templateId }, select: { domain: true } }),
  ]);

  return (
    <BlogPostEditor
      templateId={access.templateId}
      initialPost={null}
      categories={categories}
      tags={tags}
      authors={authors}
      siteDomain={domain?.domain ?? null}
    />
  );
}
