import { notFound } from "next/navigation";
import type { ResolveBlogSiteResult } from "@/lib/pub/resolveSite";
import { listPublishedPosts, getCategoryBySlug, getTagBySlug, getAuthorBySlug } from "@/lib/blog/queries";
import { archiveMetadata, archiveJsonLd } from "@/lib/blog/seo";
import { BlogStyles, SiteHeader, SiteFooter, PostCard, Pagination, EmptyState, Breadcrumbs, JsonLd } from "@/lib/pub/blogTheme";
import type { Metadata } from "next";

export type ArchiveKind = "category" | "tag" | "author";

async function resolveArchiveTarget(kind: ArchiveKind, templateId: string, slug: string) {
  if (kind === "category") return getCategoryBySlug(templateId, slug);
  if (kind === "tag") return getTagBySlug(templateId, slug);
  return getAuthorBySlug(templateId, slug);
}

/** Shared by the six archive route files (category/tag/author, each with a page/[pageNum] pagination sibling). */
export async function buildArchiveMetadata(
  domain: string,
  site: ResolveBlogSiteResult,
  kind: ArchiveKind,
  slug: string,
): Promise<Metadata> {
  if (site.status !== "ok") return {};
  const target = await resolveArchiveTarget(kind, site.published.templateId, slug);
  if (!target) return {};
  const label = kind === "author" ? `Posts by ${target.name}` : target.name;
  return archiveMetadata(domain, site.blogSite.title, label, `/blog/${kind}/${slug}`);
}

export async function BlogArchivePage({
  domain,
  site,
  kind,
  slug,
  page = 1,
}: {
  domain: string;
  site: ResolveBlogSiteResult;
  kind: ArchiveKind;
  slug: string;
  page?: number;
}) {
  if (site.status !== "ok") notFound();
  if (!Number.isInteger(page) || page < 1) notFound();

  const target = await resolveArchiveTarget(kind, site.published.templateId, slug);
  if (!target) notFound();

  const opts = kind === "category" ? { categorySlug: slug } : kind === "tag" ? { tagSlug: slug } : { authorSlug: slug };
  const result = await listPublishedPosts(site.published.templateId, { ...opts, page, perPage: site.blogSite.postsPerPage });
  // page 1 always renders (even with zero posts, so a freshly created category isn't a
  // dead link) — anything past the last real page is a genuine 404.
  if (page > 1 && result.posts.length === 0) notFound();

  const heading = kind === "author" ? `Posts by ${target.name}` : target.name;
  const basePath = `/blog/${kind}/${slug}`;

  return (
    <div className="plexo-blog">
      <BlogStyles appearance={site.blogSite} />
      <SiteHeader
        title={site.blogSite.title}
        description={heading}
        basePath="/blog"
        logoUrl={site.blogSite.logoUrl}
        headerImageUrl={site.blogSite.headerImageUrl}
      />
      <main className="plexo-blog__main">
        <Breadcrumbs trail={[{ label: "Home", href: "/" }, { label: "Blog", href: "/blog" }, { label: heading }]} />
        {result.posts.length === 0 ? (
          <EmptyState message="No posts here yet." />
        ) : (
          <div className="plexo-blog__grid">
            {result.posts.map((post) => (
              <PostCard key={post.id} post={post} basePath="/blog" />
            ))}
          </div>
        )}
        <Pagination page={result.page} totalPages={result.totalPages} buildHref={(p) => (p === 1 ? basePath : `${basePath}/page/${p}`)} />
      </main>
      <SiteFooter />
      <JsonLd items={archiveJsonLd(domain, basePath, heading, result.posts)} />
    </div>
  );
}
