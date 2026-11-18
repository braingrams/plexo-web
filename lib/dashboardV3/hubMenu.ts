import { applyCommands, createDefaultDesignSystem } from "@charisol/plexo-sdk/v2/compile";
import { SiteLayout, Template } from "@/lib/db/contentEntities";
import { recompileSiteLayoutDependents } from "@/lib/siteLayoutCore";
import { addPageToSiteMenu } from "@/lib/sites/siteNav";
import { isV2Design, type V2Design } from "@/lib/v2/design";
import { headerOf } from "./hubMenuLinks";
export { menuWithout } from "./hubMenuLinks";
import { menuWithout } from "./hubMenuLinks";

export type MenuState = { available: boolean; hrefs: string[] };

async function sharedHeader(rootId: string): Promise<{ id: string; design: V2Design } | null> {
  const { data: layout } = await SiteLayout.get({ templateId: rootId }).go();
  if (!layout?.enabled || !layout.headerTemplateId) return null;
  const { data: header } = await Template.get({ id: layout.headerTemplateId }).go();
  if (!header || header.designFormat !== "v2" || !isV2Design(header.designJson)) return null;
  return { id: header.id, design: header.designJson as V2Design };
}

export async function getMenu(rootId: string): Promise<MenuState> {
  const header = await sharedHeader(rootId);
  const h = header ? headerOf(header.design) : null;
  return h ? { available: true, hrefs: h.links.map((l) => l.href) } : { available: false, hrefs: [] };
}

/** Takes the page out of the menu (the page itself stays live). False when it wasn't in the menu. */
export async function hideFromMenu(rootId: string, href: string): Promise<boolean> {
  const header = await sharedHeader(rootId);
  if (!header) return false;
  const change = menuWithout(header.design, href);
  if (!change) return false;
  const applied = applyCommands(header.design.pages, header.design.designSystem ?? createDefaultDesignSystem(), [{ op: "updateSection", sectionId: change.sectionId, content: { links: change.links } }]);
  if (!applied.results[0]?.ok) return false;
  await Template.patch({ id: header.id }).set({ designJson: { ...header.design, pages: applied.pages } }).go();
  await recompileSiteLayoutDependents(rootId);
  return true;
}

export const showInMenu = addPageToSiteMenu;
