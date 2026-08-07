import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/server/prisma";
import { resolveBlogSite } from "@/lib/pub/resolveSite";
import { resolveBlogRedirect } from "@/lib/blog/redirects";
import { getPublishedPostBySlug, getRelatedPosts, listApprovedComments } from "@/lib/blog/queries";
import { postMetadata, postJsonLd } from "@/lib/blog/seo";
import { BlogStyles, SiteHeader, SiteFooter, PostMeta, CategoryChips, PostCard, JsonLd, Breadcrumbs } from "@/lib/pub/blogTheme";
import { hasBlogMarker, substituteBlogMarkers, extractMarkerPrefix } from "@/lib/pub/blogLayoutRender";
import { buildPostFragments } from "@/lib/pub/blogLayoutFragments";
import { renderCommentsSection } from "@/lib/pub/renderComments";

export const revalidate = 60;

type Params = { domain: string; slug: string[] };

// Catch-all (not a single [slug]) so a WordPress site that already prefixed posts with
// "/blog/..." still resolves here correctly, and so a BlogRedirect lookup has somewhere
// to run for anything already under this literal /blog segment — the legacy
// app/pub/[domain]/[[...slug]] route never sees paths under here at all.
async function loadPost(domain: string, slugSegments: string[]) {
  const site = await resolveBlogSite(decodeURIComponent(domain));
  if (site.status !== "ok" || slugSegments.length !== 1) return { site, post: null };
  const post = await getPublishedPostBySlug(site.published.templateId, slugSegments[0]);
  return { site, post };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { domain, slug } = await params;
  const { site, post } = await loadPost(domain, slug);
  if (site.status !== "ok" || !post) return {};
  return postMetadata(domain, post);
}

export default async function BlogPostPage({ params }: { params: Promise<Params> }) {
  const { domain, slug } = await params;
  const { site, post } = await loadPost(domain, slug);

  if (site.status !== "ok") notFound();

  if (!post) {
    const redirectTo = await resolveBlogRedirect(site.published.templateId, "/blog/" + slug.join("/"));
    if (redirectTo) redirect(redirectTo);
    notFound();
  }

  const commentsAllowed = site.blogSite.commentsEnabled && post.commentsEnabled;
  const comments = commentsAllowed ? await listApprovedComments(post.id) : [];
  const commentsHtml = renderCommentsSection({
    domain: site.published.domain,
    slug: post.slug,
    comments,
    commentsEnabled: commentsAllowed,
  });

  // Custom layout, if the site owner designed one and it actually has somewhere to show
  // the article (see prisma/schema.prisma's Template.isBlogLayout comment) — falls back
  // to the built-in theme below otherwise, so there's never a broken/blank state.
  const layoutTemplate = site.blogSite.postLayoutTemplateId
    ? await prisma.template.findUnique({ where: { id: site.blogSite.postLayoutTemplateId }, select: { compiledHtml: true } })
    : null;

  if (layoutTemplate && hasBlogMarker(layoutTemplate.compiledHtml, "content")) {
    const fragments = buildPostFragments(post, "/blog", commentsHtml, {
      date: extractMarkerPrefix(layoutTemplate.compiledHtml, "date"),
      author: extractMarkerPrefix(layoutTemplate.compiledHtml, "author"),
      categories: extractMarkerPrefix(layoutTemplate.compiledHtml, "categories"),
    });
    const html = substituteBlogMarkers(layoutTemplate.compiledHtml, fragments);
    return (
      <>
        {/* The substituted fragments (post body, category chips, comments) are styled
            entirely by BlogStyles' plexo-* classes — they carry no styling of their own.
            Its selectors are all namespaced (plexo-post__body, plexo-chip, plexo-comments,
            ...) so they don't collide with the custom layout's own builder-generated markup. */}
        <BlogStyles appearance={site.blogSite} />
        {/* eslint-disable-next-line react/no-danger */}
        <div dangerouslySetInnerHTML={{ __html: html }} />
        <JsonLd items={postJsonLd(domain, post)} />
      </>
    );
  }

  const related = await getRelatedPosts(site.published.templateId, post, 3);

  return (
    <div className="plexo-blog">
      <BlogStyles appearance={site.blogSite} />
      <SiteHeader
        title={site.blogSite.title}
        basePath="/blog"
        logoUrl={site.blogSite.logoUrl}
        headerImageUrl={site.blogSite.headerImageUrl}
      />
      <article className="plexo-post">
        <Breadcrumbs
          trail={[
            { label: "Home", href: "/" },
            { label: "Blog", href: "/blog" },
            ...(post.categories[0] ? [{ label: post.categories[0].category.name, href: `/blog/category/${post.categories[0].category.slug}` }] : []),
            { label: post.title },
          ]}
        />
        {post.featuredImageUrl ? (
          <img className="plexo-post__cover" src={post.featuredImageUrl} alt={post.featuredImageAlt ?? ""} />
        ) : null}
        <CategoryChips post={post} basePath="/blog" />
        <h1 className="plexo-post__title">{post.title}</h1>
        <PostMeta post={post} basePath="/blog" />
        {/* contentHtml is sanitized at write time (editor save + WordPress import) — see
            lib/blog/sanitize.ts and prisma/schema.prisma's BlogPost.contentHtml comment. */}
        <div className="plexo-post__body" dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
      </article>
      {related.length > 0 ? (
        <section className="plexo-blog__main" style={{ borderTop: "1px solid #eee", paddingTop: 32 }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: 16 }}>Related posts</h2>
          <div className="plexo-blog__grid">
            {related.map((r) => (
              <PostCard key={r.id} post={r} basePath="/blog" />
            ))}
          </div>
        </section>
      ) : null}
      {/* eslint-disable-next-line react/no-danger */}
      <div dangerouslySetInnerHTML={{ __html: commentsHtml }} />
      <SiteFooter />
      <JsonLd items={postJsonLd(domain, post)} />
    </div>
  );
}
