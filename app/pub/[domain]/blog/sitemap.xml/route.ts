import { NextResponse } from "next/server";
import { resolveBlogSite, type ResolveBlogSiteResult } from "@/lib/pub/resolveSite";
import { listAllPublishedSlugs, listAllCategories, listAllTags } from "@/lib/blog/queries";
import { siteOrigin } from "@/lib/blog/seo";

export const revalidate = 60;

function urlEntry(loc: string, lastmod?: Date | null): string {
  return `
  <url>
    <loc>${loc}</loc>${lastmod ? `\n    <lastmod>${lastmod.toISOString()}</lastmod>` : ""}
  </url>`;
}

// Tenant-published sites (anything under /pub/[domain]/**) have no sitemap of their own
// today — this is the first one, scoped to the blog. See prisma/schema.prisma's Blog*
// models comment block for the broader context.
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
  const templateId = site.published.templateId;
  const [posts, categories, tags] = await Promise.all([
    listAllPublishedSlugs(templateId),
    listAllCategories(templateId),
    listAllTags(templateId),
  ]);

  const entries = [
    urlEntry(`${origin}/blog`),
    ...posts.map((p) => urlEntry(`${origin}/blog/${p.slug}`, p.updatedAt)),
    ...categories.map((c) => urlEntry(`${origin}/blog/category/${c.slug}`)),
    ...tags.map((t) => urlEntry(`${origin}/blog/tag/${t.slug}`)),
  ].join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}
</urlset>`;

  return new NextResponse(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
