import { notFound } from "next/navigation";
import { BlogPost, BlogCategory, BlogTag, BlogAuthor, BlogPostCategory, BlogPostTag, PublishedDomain } from "@/lib/db/contentEntities";
import { requireBlogSiteAccess } from "@/lib/blog/pageAuthDynamo";
import { findOrCreateAuthorForUser } from "@/lib/blog/authorsDynamo";
import { BlogPostEditor } from "../BlogPostEditor";

export default async function EditBlogPostPage({ params }: { params: Promise<{ id: string; postId: string }> }) {
  const { id, postId } = await params;
  const access = await requireBlogSiteAccess(id, `/dashboard/templates/${id}/blog/${postId}`);

  const [currentUserAuthor, { data: allPosts }, { data: categories }, { data: tags }, { data: authors }, { data: domains }, { data: postCategories }, { data: postTags }] =
    await Promise.all([
      findOrCreateAuthorForUser(access.templateId, access.userId, access.userName || access.userEmail),
      BlogPost.query.byStatus({ templateId: access.templateId }).go(),
      BlogCategory.query.primary({ templateId: access.templateId }).go(),
      BlogTag.query.primary({ templateId: access.templateId }).go(),
      BlogAuthor.query.primary({ templateId: access.templateId }).go(),
      PublishedDomain.query.primary({ templateId: access.templateId }).go(),
      BlogPostCategory.query.primary({ templateId: access.templateId, postId }).go(),
      BlogPostTag.query.primary({ templateId: access.templateId, postId }).go(),
    ]);
  categories.sort((a, b) => a.name.localeCompare(b.name));
  tags.sort((a, b) => a.name.localeCompare(b.name));
  authors.sort((a, b) => a.name.localeCompare(b.name));

  const post = allPosts.find((p) => p.id === postId);
  if (!post) notFound();

  const tagNameById = new Map(tags.map((t) => [t.id, t.name]));

  const allAuthors = authors.some((a) => a.id === currentUserAuthor.id)
    ? authors
    : [...authors, currentUserAuthor].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <BlogPostEditor
      templateId={access.templateId}
      currentUserAuthorId={currentUserAuthor.id}
      initialPost={{
        id: post.id,
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt ?? null,
        contentJson: post.contentJson,
        featuredImageUrl: post.featuredImageUrl ?? null,
        featuredImageAlt: post.featuredImageAlt ?? null,
        status: post.status ?? "DRAFT",
        scheduledAt: post.scheduledAt ?? null,
        metaTitle: post.metaTitle ?? null,
        metaDescription: post.metaDescription ?? null,
        ogImageUrl: post.ogImageUrl ?? null,
        noindex: post.noindex ?? false,
        authorId: post.authorId ?? null,
        categoryIds: postCategories.map((c) => c.categoryId),
        tagNames: postTags.map((t) => tagNameById.get(t.tagId)).filter((n): n is string => !!n),
      }}
      categories={categories}
      tags={tags}
      authors={allAuthors}
      siteDomain={domains[0]?.domain ?? null}
    />
  );
}
