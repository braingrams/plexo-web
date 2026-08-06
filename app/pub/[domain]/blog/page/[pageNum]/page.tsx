import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveBlogSite } from "@/lib/pub/resolveSite";
import { listPublishedPosts } from "@/lib/blog/queries";
import { listingMetadata, listingJsonLd } from "@/lib/blog/seo";
import { BlogStyles, SiteHeader, SiteFooter, PostCard, Pagination, EmptyState, JsonLd } from "@/lib/pub/blogTheme";

export const revalidate = 60;

type Params = { domain: string; pageNum: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { domain } = await params;
  const site = await resolveBlogSite(decodeURIComponent(domain));
  if (site.status !== "ok") return {};
  return listingMetadata(domain, site.blogSite);
}

export default async function BlogIndexPaginatedPage({ params }: { params: Promise<Params> }) {
  const { domain, pageNum } = await params;
  const site = await resolveBlogSite(decodeURIComponent(domain));
  if (site.status !== "ok") notFound();

  const page = Number.parseInt(pageNum, 10);
  if (!Number.isInteger(page) || page < 1) notFound();
  // Page 1 canonically lives at /blog, not /blog/page/1 — avoids two URLs for the same content.
  if (page === 1) notFound();

  const result = await listPublishedPosts(site.published.templateId, { page, perPage: site.blogSite.postsPerPage });
  if (result.posts.length === 0) notFound();

  return (
    <div className="plexo-blog">
      <BlogStyles appearance={site.blogSite} />
      <SiteHeader
        title={site.blogSite.title}
        description={site.blogSite.description}
        basePath="/blog"
        logoUrl={site.blogSite.logoUrl}
        headerImageUrl={site.blogSite.headerImageUrl}
      />
      <main className="plexo-blog__main">
        <div className="plexo-blog__grid">
          {result.posts.map((post) => (
            <PostCard key={post.id} post={post} basePath="/blog" />
          ))}
        </div>
        <Pagination page={result.page} totalPages={result.totalPages} buildHref={(p) => (p === 1 ? "/blog" : `/blog/page/${p}`)} />
      </main>
      <SiteFooter />
      <JsonLd items={listingJsonLd(domain, site.blogSite, result.posts)} />
    </div>
  );
}
