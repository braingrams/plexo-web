import type { Metadata } from "next";
import type { BlogPostCard, BlogPostDetail } from "./queriesDynamo";
import { autoExcerpt } from "./content";
import { SITE_URL, MARKETING_BLOG_TITLE, MARKETING_BLOG_DESCRIPTION } from "./marketingBlog";

// The plexo.io-specific counterpart to lib/blog/seo.ts. That module is per-tenant: every
// tenant blog lives on its own domain, so it sets metadataBase per-request and points OG
// images at /api/blog-og/[domain]. The marketing blog instead lives on plexo.io itself —
// metadataBase is already set once in the root layout (app/layout.tsx), canonical paths are
// plain relative "/blog/..." strings, and the OG image is the colocated
// app/blog/[slug]/opengraph-image.tsx (Next injects it automatically when no explicit
// openGraph.images is set), so this file only overrides images when a post carries its own.

export function listingMetadata(): Metadata {
  return {
    title: MARKETING_BLOG_TITLE,
    description: MARKETING_BLOG_DESCRIPTION,
    alternates: {
      canonical: "/blog",
      types: { "application/rss+xml": "/blog/feed.xml" },
    },
    openGraph: {
      title: `${MARKETING_BLOG_TITLE} | Plexo`,
      description: MARKETING_BLOG_DESCRIPTION,
      url: "/blog",
      type: "website",
    },
  };
}

export function archiveMetadata(label: string, description: string | null, path: string): Metadata {
  const title = label;
  return {
    title,
    description: description ?? undefined,
    alternates: { canonical: path },
    openGraph: { title: `${title} | Plexo`, description: description ?? undefined, url: path, type: "website" },
  };
}

export function archiveJsonLd(path: string, label: string, posts: BlogPostCard[]) {
  return [
    {
      "@type": "CollectionPage",
      "@id": `${SITE_URL}${path}#page`,
      name: label,
      url: `${SITE_URL}${path}`,
      isPartOf: { "@id": `${SITE_URL}/blog#blog` },
    },
    {
      "@type": "ItemList",
      itemListElement: posts.map((post, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${SITE_URL}/blog/${post.slug}`,
        name: post.title,
      })),
    },
  ];
}

export function postMetadata(post: BlogPostDetail): Metadata {
  const title = post.metaTitle || post.title;
  const description = post.metaDescription || post.excerpt || autoExcerpt(post.contentHtml);
  const path = `/blog/${post.slug}`;
  // Only a post's own image overrides the colocated opengraph-image.tsx fallback.
  const ownImage = post.ogImageUrl || post.featuredImageUrl || null;

  return {
    title,
    description,
    alternates: { canonical: path },
    robots: post.noindex ? { index: false, follow: false } : undefined,
    openGraph: {
      title,
      description,
      url: path,
      type: "article",
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt?.toISOString(),
      authors: post.author ? [post.author.name] : undefined,
      images: ownImage ? [{ url: ownImage }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ownImage ? [ownImage] : undefined,
    },
  };
}

/** JSON-LD `@graph` array (not the full script tag) — the page embeds it via one <script>. */
export function listingJsonLd(posts: BlogPostCard[]) {
  return [
    {
      "@type": "Blog",
      "@id": `${SITE_URL}/blog#blog`,
      name: `${MARKETING_BLOG_TITLE} | Plexo`,
      description: MARKETING_BLOG_DESCRIPTION,
      url: `${SITE_URL}/blog`,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "ItemList",
      itemListElement: posts.map((post, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${SITE_URL}/blog/${post.slug}`,
        name: post.title,
      })),
    },
  ];
}

export function postJsonLd(post: BlogPostDetail) {
  const url = `${SITE_URL}/blog/${post.slug}`;
  const image = post.ogImageUrl || post.featuredImageUrl || `${SITE_URL}/blog/${post.slug}/opengraph-image`;

  const posting = {
    "@type": "BlogPosting",
    "@id": `${url}#post`,
    mainEntityOfPage: url,
    headline: post.title,
    description: post.metaDescription || post.excerpt || undefined,
    image: [image],
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt?.toISOString(),
    author: post.author ? { "@type": "Person", name: post.author.name } : { "@id": `${SITE_URL}/#organization` },
    publisher: { "@id": `${SITE_URL}/#organization` },
  };

  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_URL}/blog` },
      { "@type": "ListItem", position: 3, name: post.title, item: url },
    ],
  };

  return [posting, breadcrumb];
}
