import { Template } from "@/lib/db/contentEntities";

export type SitePage = { id: string; path: string; name: string; html: string };

const MAX_PAGES = 40;

/** Every page of a site that visitors can open (home first, then the page tree), with its stored HTML. Same rules as the sitemap. */
export async function loadSitePages(rootId: string, fallback?: { name: string; html: string }): Promise<SitePage[]> {
  const only = fallback ? [{ id: rootId, path: "/", name: fallback.name, html: fallback.html }] : [];
  let root;
  try {
    root = (await Template.get({ id: rootId }).go()).data;
  } catch {
    return only;
  }
  if (!root) return only;
  const out: SitePage[] = [{ id: root.id, path: "/", name: root.name, html: root.compiledHtml }];
  const queue: { id: string; segments: string[] }[] = [{ id: root.id, segments: [] }];
  while (queue.length && out.length < MAX_PAGES) {
    const { id, segments } = queue.shift()!;
    const { data: children } = await Template.query.byParent({ parentId: id }).go({ pages: "all" });
    for (const child of children.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      if (!child.slug || child.isSiteLayoutFragment || child.isBlogLayout || child.isLmsPageDesign || child.isPublished === false || child.redirectTo) continue;
      const seg = [...segments, child.slug];
      queue.push({ id: child.id, segments: seg });
      if (out.length < MAX_PAGES) out.push({ id: child.id, path: `/${seg.map(encodeURIComponent).join("/")}${child.urlTrailingSlash ? "/" : ""}`, name: child.name, html: child.compiledHtml });
    }
  }
  return out;
}
