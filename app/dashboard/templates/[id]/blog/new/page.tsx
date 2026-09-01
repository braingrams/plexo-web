import { BlogCategory, BlogTag, BlogAuthor, PublishedDomain } from "@/lib/db/contentEntities";
import { requireBlogSiteAccess } from "@/lib/blog/pageAuthDynamo";
import { findOrCreateAuthorForUser } from "@/lib/blog/authorsDynamo";
import { BlogPostEditor } from "../BlogPostEditor";

export default async function NewBlogPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBlogSiteAccess(id, `/dashboard/templates/${id}/blog/new`);

  const [currentUserAuthor, { data: categories }, { data: tags }, { data: authors }, { data: domains }] = await Promise.all([
    findOrCreateAuthorForUser(access.templateId, access.userId, access.userName || access.userEmail),
    BlogCategory.query.primary({ templateId: access.templateId }).go(),
    BlogTag.query.primary({ templateId: access.templateId }).go(),
    BlogAuthor.query.primary({ templateId: access.templateId }).go(),
    PublishedDomain.query.primary({ templateId: access.templateId }).go(),
  ]);
  categories.sort((a, b) => a.name.localeCompare(b.name));
  tags.sort((a, b) => a.name.localeCompare(b.name));
  authors.sort((a, b) => a.name.localeCompare(b.name));

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
      siteDomain={domains[0]?.domain ?? null}
    />
  );
}
