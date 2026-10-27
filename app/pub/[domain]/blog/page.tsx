import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { resolveBlogSite } from "@/lib/pub/resolveSiteDynamo";
import { listPublishedPosts } from "@/lib/blog/queriesDynamo";
import { listingMetadata, listingJsonLd } from "@/lib/blog/seo";
import { BlogStyles, SiteHeader, SiteFooter, PostCard, Pagination, EmptyState, JsonLd } from "@/lib/pub/blogTheme";
import { ListingInLayout, loadListingLayoutHtml } from "@/lib/pub/blogListingLayout";

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
  return listingMetadata(domain, { title: site.blogSite.title ?? "Blog", description: site.blogSite.description ?? null, metaTitle: site.blogSite.metaTitle ?? null });
}

export default async function BlogIndexPage({ params }: { params: Promise<Params> }) {
  const { domain } = await params;
  const site = await loadSite(domain);
  if (site.status === "deployed") redirect("/_dp/blog");
  if (site.status !== "ok") notFound();

  const result = await listPublishedPosts(site.published.templateId, { page: 1, perPage: site.blogSite.postsPerPage ?? 10 });

  // Custom layout, if designed and it has somewhere to show the post list — see
  // prisma/schema.prisma's Template.isBlogLayout comment. Scoped to this page (page 1)
  // only; paginated/category/tag/author archive pages still use the default theme, same
  // as any site that hasn't designed a listing layout at all.
  const blogSiteView = { title: site.blogSite.title ?? "Blog", description: site.blogSite.description ?? null };

  const layoutHtml = await loadListingLayoutHtml(site.blogSite);
  if (layoutHtml) {
    return (
      <ListingInLayout
        layoutHtml={layoutHtml}
        blogSite={site.blogSite}
        siteTemplateId={site.published.templateId}
        posts={result.posts}
        options={{ pagination: { page: result.page, totalPages: result.totalPages, buildHref: (p) => (p === 1 ? "/blog" : `/blog/page/${p}`) } }}
        jsonLd={listingJsonLd(domain, blogSiteView, result.posts)}
      />
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
          <EmptyState message="Posts will appear here as soon as they're published." />
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
