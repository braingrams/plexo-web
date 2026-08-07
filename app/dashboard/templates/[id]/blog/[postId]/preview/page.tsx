import { notFound } from "next/navigation";
import { prisma } from "@/server/prisma";
import { requireBlogSiteAccess } from "@/lib/blog/pageAuth";
import { DETAIL_SELECT } from "@/lib/blog/queries";
import { BlogStyles, SiteHeader, PostMeta, CategoryChips } from "@/lib/pub/blogTheme";
import { hasBlogMarker, substituteBlogMarkers } from "@/lib/pub/blogLayoutRender";
import { buildPostFragments } from "@/lib/pub/blogLayoutFragments";

const PREVIEW_BANNER = (status: string) => (
  <div style={{ background: "#f59e0b", color: "#1a1300", textAlign: "center", padding: "0.5rem", fontSize: "0.8rem", fontWeight: 700 }}>
    Preview — status: {status}. This page isn&apos;t what visitors see unless the post is published.
  </div>
);

// Deliberately NOT on the public tenant domain — this reuses the dashboard's own
// authentication (requireBlogSiteAccess) instead of a signed public preview token, which
// is simpler and can't leak an unpublished post if a token URL is ever shared/cached.
export default async function BlogPostPreviewPage({ params }: { params: Promise<{ id: string; postId: string }> }) {
  const { id, postId } = await params;
  const access = await requireBlogSiteAccess(id, `/dashboard/templates/${id}/blog/${postId}/preview`);

  const [post, blogSite] = await Promise.all([
    prisma.blogPost.findFirst({
      where: { id: postId, templateId: access.templateId },
      select: { ...DETAIL_SELECT, status: true },
    }),
    prisma.blogSite.findUnique({ where: { templateId: access.templateId } }),
  ]);
  if (!post) notFound();

  // Mirrors app/pub/[domain]/blog/[...slug]/page.tsx's own branching — a preview that
  // always showed the default theme regardless of a configured custom layout wasn't
  // actually previewing what visitors would see, which is the whole point of this page.
  const layoutTemplate = blogSite?.postLayoutTemplateId
    ? await prisma.template.findUnique({ where: { id: blogSite.postLayoutTemplateId }, select: { compiledHtml: true } })
    : null;

  if (layoutTemplate && hasBlogMarker(layoutTemplate.compiledHtml, "content")) {
    const fragments = buildPostFragments(post, "/blog", "");
    const html = substituteBlogMarkers(layoutTemplate.compiledHtml, fragments);
    return (
      <>
        {PREVIEW_BANNER(post.status)}
        <BlogStyles appearance={blogSite ?? undefined} />
        {/* eslint-disable-next-line react/no-danger */}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </>
    );
  }

  return (
    <div className="plexo-blog" style={{ background: "#fff" }}>
      <BlogStyles appearance={blogSite ?? undefined} />
      {PREVIEW_BANNER(post.status)}
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
