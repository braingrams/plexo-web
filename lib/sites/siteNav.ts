import { applyCommands, createDefaultDesignSystem } from "@charisol/plexo-sdk/v2/compile";

import { SiteLayout, Template } from "@/lib/db/contentEntities";
import { recompileSiteLayoutDependents } from "@/lib/siteLayoutCore";
import { isV2Design, type V2Design } from "@/lib/v2/design";

/** The menu holds at most this many links (the SDK header's own limit). */
const MAX_MENU_LINKS = 8;

type Link = { label: string; href: string };
type HeaderBlock = { kind?: string; content?: { links?: Link[] } };

/**
 * The shared header's menu after adding a page: unchanged (null) when the link is already
 * there, the menu is full, or the header isn't a visual-editor section. Pure — exported for tests.
 */
export function menuWithPage(design: V2Design, label: string, href: string): { sectionId: string; links: Link[] } | null {
  const sections = design.pages[0]?.rootNode.children ?? [];
  const header = sections.find((n) => (n.props as { block?: HeaderBlock } | undefined)?.block?.kind === "header");
  if (!header) return null;
  const links = ((header.props as { block?: HeaderBlock }).block?.content?.links ?? []).map((l) => ({ label: l.label, href: l.href }));
  if (links.some((l) => l.href === href) || links.length >= MAX_MENU_LINKS) return null;
  // Keep "Contact" last: a new page goes just before it.
  const contactAt = links.findIndex((l) => /contact/i.test(l.href) && l.href !== "/");
  const next = [...links];
  next.splice(contactAt >= 0 ? contactAt : next.length, 0, { label: label.trim().slice(0, 24), href });
  return { sectionId: header.id, links: next };
}

/**
 * Adds a page to the site's shared menu (Site layout header) so a page added later is
 * reachable without the owner editing the menu by hand. No-op for a site without a shared
 * visual header, a page already in the menu, or a full menu.
 */
export async function addPageToSiteMenu(rootId: string, label: string, href: string): Promise<boolean> {
  const { data: layout } = await SiteLayout.get({ templateId: rootId }).go();
  if (!layout?.enabled || !layout.headerTemplateId) return false;
  const { data: header } = await Template.get({ id: layout.headerTemplateId }).go();
  if (!header || header.designFormat !== "v2" || !isV2Design(header.designJson)) return false;
  const design = header.designJson as V2Design;
  const change = menuWithPage(design, label, href);
  if (!change) return false;
  const applied = applyCommands(design.pages, design.designSystem ?? createDefaultDesignSystem(), [{ op: "updateSection", sectionId: change.sectionId, content: { links: change.links } }]);
  if (!applied.results[0]?.ok) return false;
  const nextDesign: V2Design = { ...design, pages: applied.pages };
  await Template.patch({ id: header.id }).set({ designJson: nextDesign }).go();
  await recompileSiteLayoutDependents(rootId);
  return true;
}
