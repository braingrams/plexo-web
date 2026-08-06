import { notFound } from "next/navigation";
import { prisma } from "@/server/prisma";
import { requireBlogSiteAccess } from "@/lib/blog/pageAuth";
import { BlogStyles, SiteHeader, PostMeta, CategoryChips } from "@/lib/pub/blogTheme";

// Deliberately NOT on the public tenant domain — this reuses the dashboard's own
// authentication (requireBlogSiteAccess) instead of a signed public preview token, which
// is simpler and can't leak an unpublished post if a token URL is ever shared/cached.
export default async function BlogPostPreviewPage({ params }: { params: Promise<{ id: string; postId: string }> }) {
  const { id, postId } = await params;
  const access = await requireBlogSiteAccess(id, `/dashboard/templates/${id}/blog/${postId}/preview`);

  const [post, blogSite] = await Promise.all([
    prisma.blogPost.findFirst({
      where: { id: postId, templateId: access.templateId },
      select: {
        id: true,
        title: true,
        slug: true,
        excerpt: true,
        contentHtml: true,
        featuredImageUrl: true,
        featuredImageAlt: true,
        publishedAt: true,
        readingTimeMinutes: true,
        status: true,
        author: { select: { name: true, slug: true, avatarUrl: true } },
        categories: { select: { category: { select: { name: true, slug: true } } } },
        tags: { select: { tag: { select: { name: true, slug: true } } } },
      },
    }),
    prisma.blogSite.findUnique({ where: { templateId: access.templateId } }),
  ]);
  if (!post) notFound();

  return (
    <div className="plexo-blog" style={{ background: "#fff" }}>
      <BlogStyles appearance={blogSite ?? undefined} />
      <div style={{ background: "#f59e0b", color: "#1a1300", textAlign: "center", padding: "0.5rem", fontSize: "0.8rem", fontWeight: 700 }}>
        Preview — status: {post.status}. This page isn&apos;t what visitors see unless the post is published.
      </div>
      <SiteHeader
        title={blogSite?.title ?? "Blog"}
        basePath="/blog"
        logoUrl={blogSite?.logoUrl}
        headerImageUrl={blogSite?.headerImageUrl}
      />
      <article className="plexo-post">
        {post.featuredImageUrl ? <img className="plexo-post__cover" src={post.featuredImageUrl} alt={post.featuredImageAlt ?? ""} /> : null}
        <CategoryChips post={post} basePath="/blog" />
        <h1 className="plexo-post__title">{post.title}</h1>
        <PostMeta post={post} basePath="/blog" />
        <div className="plexo-post__body" dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
      </article>
    </div>
  );
}
