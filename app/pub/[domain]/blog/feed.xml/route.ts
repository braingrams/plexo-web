import { NextResponse } from "next/server";
import { resolveBlogSite, type ResolveBlogSiteResult } from "@/lib/pub/resolveSite";
import { listAllPublishedSlugs } from "@/lib/blog/queries";
import { siteOrigin } from "@/lib/blog/seo";

export const revalidate = 60;

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function GET(
  request: Request,
  context: { params: Promise<{ domain: string }> },
): Promise<NextResponse> {
  const { domain: rawDomain } = await context.params;
  const domain = decodeURIComponent(rawDomain);
  const site: ResolveBlogSiteResult = await resolveBlogSite(domain);
  if (site.status !== "ok") {
    return new NextResponse("Not found", { status: 404 });
  }

  const origin = siteOrigin(domain);
  const posts = await listAllPublishedSlugs(site.published.templateId, 50);

  const items = posts
    .map(
      (post) => `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${origin}/blog/${post.slug}</link>
      <guid isPermaLink="true">${origin}/blog/${post.slug}</guid>
      <pubDate>${(post.publishedAt ?? post.updatedAt).toUTCString()}</pubDate>
      ${post.excerpt ? `<description>${escapeXml(post.excerpt)}</description>` : ""}
    </item>`,
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(site.blogSite.title)}</title>
    <link>${origin}/blog</link>
    <description>${escapeXml(site.blogSite.description ?? "")}</description>${items}
  </channel>
</rss>`;

  return new NextResponse(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
