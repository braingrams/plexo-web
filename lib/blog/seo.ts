import type { Metadata } from "next";
import type { BlogSite } from "@prisma/client";
import type { BlogPostCard, BlogPostDetail } from "./queries";
import { autoExcerpt } from "./content";

/** Every tenant blog lives on its own domain — metadataBase must be set per-request. */
export function siteOrigin(domain: string): string {
  return `https://${domain}`;
}

export function listingMetadata(domain: string, blogSite: Pick<BlogSite, "title" | "description">): Metadata {
  return {
    metadataBase: new URL(siteOrigin(domain)),
    title: blogSite.title,
    description: blogSite.description ?? undefined,
    alternates: {
      canonical: "/blog",
      types: { "application/rss+xml": "/blog/feed.xml" },
    },
    openGraph: {
      title: blogSite.title,
      description: blogSite.description ?? undefined,
      url: "/blog",
      type: "website",
    },
  };
}

export function archiveMetadata(domain: string, blogSiteTitle: string, archiveLabel: string, path: string): Metadata {
  const title = `${archiveLabel} — ${blogSiteTitle}`;
  return {
    metadataBase: new URL(siteOrigin(domain)),
    title,
    alternates: { canonical: path },
    openGraph: { title, url: path, type: "website" },
  };
}

export function postMetadata(domain: string, post: BlogPostDetail): Metadata {
  const title = post.metaTitle || post.title;
  const description = post.metaDescription || post.excerpt || autoExcerpt(post.contentHtml);
  const path = `/blog/${post.slug}`;
  // Falls back to a generated branded card (app/api/blog-og/[domain]/[...slug]) when the
  // post has no image of its own — see that route's comment for why it isn't a colocated
  // opengraph-image.tsx file (Next disallows that inside a catch-all route segment).
  const image = post.ogImageUrl || post.featuredImageUrl || `${siteOrigin(domain)}/api/blog-og/${domain}/${post.slug}`;

  return {
    metadataBase: new URL(siteOrigin(domain)),
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
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

/** JSON-LD `@graph` array (not the full script tag) — callers embed via one shared <script>. */
export function listingJsonLd(domain: string, blogSite: Pick<BlogSite, "title" | "description">, posts: BlogPostCard[]) {
  const origin = siteOrigin(domain);
  return [
    {
      "@type": "Blog",
      "@id": `${origin}/blog#blog`,
      name: blogSite.title,
      description: blogSite.description ?? undefined,
      url: `${origin}/blog`,
    },
    {
      "@type": "ItemList",
      itemListElement: posts.map((post, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${origin}/blog/${post.slug}`,
        name: post.title,
      })),
    },
  ];
}

/** Same Blog+ItemList shape as listingJsonLd, for a category/tag/author archive page. */
export function archiveJsonLd(domain: string, path: string, label: string, posts: BlogPostCard[]) {
  const origin = siteOrigin(domain);
  return [
    {
      "@type": "CollectionPage",
      "@id": `${origin}${path}#page`,
      name: label,
      url: `${origin}${path}`,
    },
    {
      "@type": "ItemList",
      itemListElement: posts.map((post, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${origin}/blog/${post.slug}`,
        name: post.title,
      })),
    },
  ];
}

export function postJsonLd(domain: string, post: BlogPostDetail) {
  const origin = siteOrigin(domain);
  const url = `${origin}/blog/${post.slug}`;
  const image = post.ogImageUrl || post.featuredImageUrl || undefined;

  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: origin },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${origin}/blog` },
      { "@type": "ListItem", position: 3, name: post.title, item: url },
    ],
  };

  const posting = {
    "@type": "BlogPosting",
    "@id": `${url}#post`,
    mainEntityOfPage: url,
    headline: post.title,
    description: post.metaDescription || post.excerpt || undefined,
    image: image ? [image] : undefined,
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt?.toISOString(),
    author: post.author ? { "@type": "Person", name: post.author.name } : undefined,
  };

  return [posting, breadcrumb];
}
