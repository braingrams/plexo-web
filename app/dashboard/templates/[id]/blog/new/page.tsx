import { prisma } from "@/server/prisma";
import { requireBlogSiteAccess } from "@/lib/blog/pageAuth";
import { findOrCreateAuthorForUser } from "@/lib/blog/authors";
import { BlogPostEditor } from "../BlogPostEditor";

export default async function NewBlogPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBlogSiteAccess(id, `/dashboard/templates/${id}/blog/new`);

  const [currentUserAuthor, categories, tags, authors, domain] = await Promise.all([
    findOrCreateAuthorForUser(access.templateId, access.userId, access.userName || access.userEmail),
    prisma.blogCategory.findMany({ where: { templateId: access.templateId }, orderBy: { name: "asc" } }),
    prisma.blogTag.findMany({ where: { templateId: access.templateId }, orderBy: { name: "asc" } }),
    prisma.blogAuthor.findMany({ where: { templateId: access.templateId }, orderBy: { name: "asc" } }),
    prisma.publishedDomain.findFirst({ where: { templateId: access.templateId }, select: { domain: true } }),
  ]);

  // findOrCreateAuthorForUser may have just created the row this same request — make sure
  // it's reflected in the dropdown's option list even though `authors` was fetched in parallel.
  const allAuthors = authors.some((a) => a.id === currentUserAuthor.id)
    ? authors
    : [...authors, currentUserAuthor].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <BlogPostEditor
      templateId={access.templateId}
      initialPost={null}
      categories={categories}
      tags={tags}
      authors={allAuthors}
      currentUserAuthorId={currentUserAuthor.id}
      siteDomain={domain?.domain ?? null}
    />
  );
}
