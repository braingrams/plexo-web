import { notFound } from "next/navigation";
import { prisma } from "@/server/prisma";
import { requireBlogSiteAccess } from "@/lib/blog/pageAuth";
import { BlogPostEditor } from "../BlogPostEditor";

export default async function EditBlogPostPage({ params }: { params: Promise<{ id: string; postId: string }> }) {
  const { id, postId } = await params;
  const access = await requireBlogSiteAccess(id, `/dashboard/templates/${id}/blog/${postId}`);

  const [post, categories, tags, authors, domain] = await Promise.all([
    prisma.blogPost.findFirst({
      where: { id: postId, templateId: access.templateId },
      include: {
        categories: { select: { categoryId: true } },
        tags: { select: { tag: { select: { name: true } } } },
      },
    }),
    prisma.blogCategory.findMany({ where: { templateId: access.templateId }, orderBy: { name: "asc" } }),
    prisma.blogTag.findMany({ where: { templateId: access.templateId }, orderBy: { name: "asc" } }),
    prisma.blogAuthor.findMany({ where: { templateId: access.templateId }, orderBy: { name: "asc" } }),
    prisma.publishedDomain.findFirst({ where: { templateId: access.templateId }, select: { domain: true } }),
  ]);

  if (!post) notFound();

  return (
    <BlogPostEditor
      templateId={access.templateId}
      initialPost={{
        id: post.id,
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        contentJson: post.contentJson,
        featuredImageUrl: post.featuredImageUrl,
        featuredImageAlt: post.featuredImageAlt,
        status: post.status,
        scheduledAt: post.scheduledAt?.toISOString() ?? null,
        metaTitle: post.metaTitle,
        metaDescription: post.metaDescription,
        ogImageUrl: post.ogImageUrl,
        noindex: post.noindex,
        authorId: post.authorId,
        categoryIds: post.categories.map((c) => c.categoryId),
        tagNames: post.tags.map((t) => t.tag.name),
      }}
      categories={categories}
      tags={tags}
      authors={authors}
      siteDomain={domain?.domain ?? null}
    />
  );
}
