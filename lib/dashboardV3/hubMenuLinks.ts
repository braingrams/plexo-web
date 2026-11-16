import type { V2Design } from "@/lib/v2/design";

/** The site's menu is the links in its shared header. Pure helpers, so they can be tested without a database. */
type Link = { label: string; href: string };
type HeaderBlock = { kind?: string; content?: { links?: Link[] } };

export function headerOf(design: V2Design): { id: string; links: Link[] } | null {
  const header = (design.pages[0]?.rootNode.children ?? []).find((n) => (n.props as { block?: HeaderBlock } | undefined)?.block?.kind === "header");
  if (!header) return null;
  return { id: header.id, links: ((header.props as { block?: HeaderBlock }).block?.content?.links ?? []).map((l) => ({ label: l.label, href: l.href })) };
}

/** The links left after hiding `href`; null when it wasn't there. Pure. */
export function menuWithout(design: V2Design, href: string): { sectionId: string; links: Link[] } | null {
  const h = headerOf(design);
  if (!h || !h.links.some((l) => l.href === href)) return null;
  return { sectionId: h.id, links: h.links.filter((l) => l.href !== href) };
}

