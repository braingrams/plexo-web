import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveBlogSite } from "@/lib/pub/resolveSiteDynamo";
import { listPublishedPosts } from "@/lib/blog/queriesDynamo";
import { Template } from "@/lib/db/contentEntities";
import { listingMetadata, listingJsonLd } from "@/lib/blog/seo";
import { BlogStyles, SiteHeader, SiteFooter, PostCard, Pagination, EmptyState, JsonLd } from "@/lib/pub/blogTheme";
import { hasBlogMarker, substituteBlogMarkers } from "@/lib/pub/blogLayoutRender";
import { buildPostListFragment } from "@/lib/pub/blogLayoutFragments";

export const revalidate = 60;

type Params = { domain: string };

async function loadSite(rawDomain: string) {
  return resolveBlogSite(decodeURIComponent(rawDomain));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { domain } = await params;
  const site = await loadSite(domain);
  if (site.status !== "ok") return {};
  // seo.ts's listingMetadata/listingJsonLd take a Pick<Prisma.BlogSite, "title"|"description">
  // with description as a required (nullable) key — BlogSite's DynamoDB entity type has it
  // as an optional attribute instead, so it's normalized here rather than passed straight
  // through, same "construct the exact shape" adapter every ported pub page in this
  // migration uses at the boundary with a not-yet-ported shared render helper.
  return listingMetadata(domain, { title: site.blogSite.title ?? "Blog", description: site.blogSite.description ?? null });
}

export default async function BlogIndexPage({ params }: { params: Promise<Params> }) {
  const { domain } = await params;
  const site = await loadSite(domain);
  if (site.status !== "ok") notFound();

  const result = await listPublishedPosts(site.published.templateId, { page: 1, perPage: site.blogSite.postsPerPage ?? 10 });

  // Custom layout, if designed and it has somewhere to show the post list — see
  // prisma/schema.prisma's Template.isBlogLayout comment. Scoped to this page (page 1)
  // only; paginated/category/tag/author archive pages still use the default theme, same
  // as any site that hasn't designed a listing layout at all.
  const layoutTemplate = site.blogSite.listingLayoutTemplateId
    ? (await Template.get({ id: site.blogSite.listingLayoutTemplateId }).go()).data
    : null;

  const blogSiteView = { title: site.blogSite.title ?? "Blog", description: site.blogSite.description ?? null };

  if (layoutTemplate && hasBlogMarker(layoutTemplate.compiledHtml, "postList")) {
    const html = substituteBlogMarkers(layoutTemplate.compiledHtml, { postList: buildPostListFragment(result.posts, "/blog") });
    return (
      <>
        {/* The substituted post-card fragments are styled entirely by BlogStyles'
            plexo-post-card__* classes — they carry no styling of their own. Its selectors
            are all namespaced so they don't collide with the custom layout's own
            builder-generated markup. */}
        <BlogStyles appearance={site.blogSite} />
        {/* eslint-disable-next-line react/no-danger */}
        <div dangerouslySetInnerHTML={{ __html: html }} />
        <JsonLd items={listingJsonLd(domain, blogSiteView, result.posts)} />
      </>
    );
  }

  return (
    <div className="plexo-blog">
      <BlogStyles appearance={site.blogSite} />
      <SiteHeader
        title={site.blogSite.title ?? "Blog"}
        description={site.blogSite.description}
        basePath="/blog"
        logoUrl={site.blogSite.logoUrl}
        headerImageUrl={site.blogSite.headerImageUrl}
      />
      <main className="plexo-blog__main">
        {result.posts.length === 0 ? (
          <EmptyState message="No posts published yet." />
        ) : (
          <div className="plexo-blog__grid">
            {result.posts.map((post) => (
              <PostCard key={post.id} post={post} basePath="/blog" />
            ))}
          </div>
        )}
        <Pagination page={result.page} totalPages={result.totalPages} buildHref={(p) => (p === 1 ? "/blog" : `/blog/page/${p}`)} />
      </main>
      <SiteFooter />
      <JsonLd items={listingJsonLd(domain, blogSiteView, result.posts)} />
    </div>
  );
}
