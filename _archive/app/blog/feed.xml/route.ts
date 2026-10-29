import { NextResponse } from "next/server";
import { listAllPublishedSlugs } from "@/lib/blog/queriesDynamo";
import {
  MARKETING_BLOG_TEMPLATE_ID,
  MARKETING_BLOG_TITLE,
  MARKETING_BLOG_DESCRIPTION,
  SITE_URL,
} from "@/lib/blog/marketingBlog";

export const revalidate = 60;

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// RSS feed for the plexo.io blog — the plexo.io-specific counterpart to the per-tenant
// app/pub/[domain]/blog/feed.xml route. Linked from the /blog page's metadata
// (marketingSeo.ts's alternates.types).
export async function GET(): Promise<NextResponse> {
  const posts = await listAllPublishedSlugs(MARKETING_BLOG_TEMPLATE_ID, 50);

  const items = posts
    .map(
      (post) => `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${SITE_URL}/blog/${post.slug}</link>
      <guid isPermaLink="true">${SITE_URL}/blog/${post.slug}</guid>
      <pubDate>${(post.publishedAt ?? post.updatedAt).toUTCString()}</pubDate>
      ${post.excerpt ? `<description>${escapeXml(post.excerpt)}</description>` : ""}
    </item>`,
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(`${MARKETING_BLOG_TITLE} | Plexo`)}</title>
    <link>${SITE_URL}/blog</link>
    <atom:link href="${SITE_URL}/blog/feed.xml" rel="self" type="application/rss+xml" />
    <description>${escapeXml(MARKETING_BLOG_DESCRIPTION)}</description>${items}
  </channel>
</rss>`;

  return new NextResponse(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
