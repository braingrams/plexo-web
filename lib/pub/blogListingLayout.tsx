import { Template } from "@/lib/db/contentEntities";
import { listPublishedPosts, type BlogPostCard } from "@/lib/blog/queriesDynamo";
import { hasLivePostLists, renderLivePostLists, type PostListSpec } from "@/lib/pub/blogLivePostLists";
import { toLivePost } from "@/lib/pub/livePostQueries";
import { BlogStyles, JsonLd, type BlogAppearance } from "@/lib/pub/blogTheme";
import { hasBlogMarker, substituteBlogMarkers } from "@/lib/pub/blogLayoutRender";
import { buildPostListFragment, paginationHtml, type PostListOptions } from "@/lib/pub/blogLayoutFragments";

// Every blog listing — the index, its page 2+, and category/tag/author archives — renders
// through the site's custom listing layout when it has one, so a reader never sees the
// site's own design on page 1 and Plexo's default design on page 2 or on a category. (Only
// the index used it before; a WordPress migration's blog layout made the gap obvious.)

/** The listing layout's compiled HTML, or null when there's no usable custom layout. */
export async function loadListingLayoutHtml(blogSite: { listingLayoutTemplateId?: string | null }): Promise<string | null> {
  if (!blogSite.listingLayoutTemplateId) return null;
  const { data: layout } = await Template.get({ id: blogSite.listingLayoutTemplateId }).go();
  return layout && hasBlogMarker(layout.compiledHtml, "postList") ? layout.compiledHtml : null;
}

export async function ListingInLayout({
  layoutHtml,
  blogSite,
  siteTemplateId,
  posts,
  options,
  jsonLd,
}: {
  layoutHtml: string;
  blogSite: BlogAppearance & { title?: string | null };
  siteTemplateId: string;
  posts: BlogPostCard[];
  options: PostListOptions;
  jsonLd: unknown[];
}) {
  let html = layoutHtml;
  const pagination = options.pagination ? paginationHtml(options.pagination) : "";
  const heading = escapeText(options.heading ?? blogSite.title ?? "Blog");
  if (hasLivePostLists(html)) {
    // A layout made from the site's own blog page (WordPress migration): its main list shows
    // this page of posts in the site's own card design; any other list (a sidebar's "recent
    // posts") shows the latest ones.
    html = await renderLivePostLists(html, async (spec) => {
      if (spec.main) return posts.map((p) => toLivePost(p));
      return (await fillSpec(siteTemplateId, spec)).map((p) => toLivePost(p));
    });
    html = substituteBlogMarkers(html, { heading, pagination });
  } else {
    // A layout with its own heading slot shows the heading there, not above the cards too.
    const ownHeading = hasBlogMarker(html, "heading");
    html = substituteBlogMarkers(html, {
      postList: buildPostListFragment(posts, "/blog", ownHeading ? { ...options, heading: undefined } : options),
      heading,
      pagination: "",
    });
  }
  return (
    <>
      {/* The post cards/pagination are styled by BlogStyles' namespaced plexo-* classes —
          they carry no styling of their own, and don't collide with the layout's markup. */}
      <BlogStyles appearance={blogSite} />
      {/* eslint-disable-next-line react/no-danger */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <JsonLd items={jsonLd} />
    </>
  );
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function fillSpec(siteTemplateId: string, spec: PostListSpec): Promise<BlogPostCard[]> {
  const { posts } = await listPublishedPosts(siteTemplateId, {
    page: 1,
    perPage: spec.count + spec.offset,
    ...(spec.category ? { categorySlug: spec.category } : {}),
  });
  return posts.slice(spec.offset);
}
