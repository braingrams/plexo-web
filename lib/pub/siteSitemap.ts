import type { EntityItem } from "electrodb";
import { BlogSite, Template } from "@/lib/db/contentEntities";
import { listAllCategories, listAllPublishedSlugs, listAllTags } from "@/lib/blog/queriesDynamo";

// /sitemap.xml and /robots.txt for every published site — previously a tenant site had
// no sitemap except the blog's own (/blog/sitemap.xml), so a multi-page site's pages were
// only discoverable by crawling. This matters most for a site migrated from WordPress,
// where an SEO plugin (Yoast, Rank Math) generated both files: losing them on switch-over
// would be a silent SEO regression. A file the owner uploaded themselves at the same path
// always wins — the serve route only calls these when no such TemplateAsset exists.

type TemplateItem = EntityItem<typeof Template>;

const MAX_SITEMAP_URLS = 5000;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function isNoindex(html: string): boolean {
  return /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html) || /<meta[^>]+content=["'][^"']*noindex[^"']*["'][^>]+name=["']robots["']/i.test(html);
}

function encodeSegments(segments: string[]): string {
  return segments.map((s) => encodeURIComponent(s)).join("/");
}

/** Every publicly-served page of a site, depth-first, as absolute URLs on `host`. */
async function listSitePages(root: TemplateItem, host: string, homeOnly: boolean): Promise<{ loc: string; lastmod?: string }[]> {
  const out: { loc: string; lastmod?: string }[] = [];
  if (!isNoindex(root.compiledHtml)) out.push({ loc: `https://${host}/`, lastmod: root.updatedAt });
  if (homeOnly) return out;

  const queue: { node: TemplateItem; segments: string[] }[] = [{ node: root, segments: [] }];
  while (queue.length > 0 && out.length < MAX_SITEMAP_URLS) {
    const { node, segments } = queue.shift()!;
    const { data: children } = await Template.query.byParent({ parentId: node.id }).go({ pages: "all" });
    for (const child of children.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      // An unpublished page (and everything under it) isn't served, so it isn't listed.
      if (!child.slug || child.isSiteLayoutFragment || child.isBlogLayout || child.isLmsPageDesign || child.isPublished === false) continue;
      const childSegments = [...segments, child.slug];
      queue.push({ node: child, segments: childSegments });
      if (child.redirectTo || isNoindex(child.compiledHtml)) continue;
      out.push({ loc: `https://${host}/${encodeSegments(childSegments)}${child.urlTrailingSlash ? "/" : ""}`, lastmod: child.updatedAt });
    }
  }
  return out;
}

/** `homeOnly`: the owner's plan serves just the homepage (Free) — list only that. */
export async function buildSiteSitemap(root: TemplateItem, host: string, opts: { homeOnly?: boolean } = {}): Promise<string> {
  const homeOnly = opts.homeOnly ?? false;
  const entries = await listSitePages(root, host, homeOnly);

  const { data: blogSite } = homeOnly ? { data: null } : await BlogSite.get({ templateId: root.id }).go();
  if (blogSite?.enabled) {
    const [posts, categories, tags] = await Promise.all([listAllPublishedSlugs(root.id), listAllCategories(root.id), listAllTags(root.id)]);
    entries.push({ loc: `https://${host}/blog` });
    for (const p of posts) entries.push({ loc: `https://${host}/blog/${encodeURIComponent(p.slug)}`, lastmod: p.updatedAt?.toISOString() });
    for (const c of categories) entries.push({ loc: `https://${host}/blog/category/${encodeURIComponent(c.slug)}` });
    for (const t of tags) entries.push({ loc: `https://${host}/blog/tag/${encodeURIComponent(t.slug)}` });
  }

  const body = entries
    .slice(0, MAX_SITEMAP_URLS)
    .map((e) => `  <url>\n    <loc>${escapeXml(e.loc)}</loc>${e.lastmod ? `\n    <lastmod>${escapeXml(e.lastmod)}</lastmod>` : ""}\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function buildSiteRobotsTxt(host: string, noindex: boolean): string {
  if (noindex) return "User-agent: *\nDisallow: /\n";
  return `User-agent: *\nAllow: /\n\nSitemap: https://${host}/sitemap.xml\n`;
}
