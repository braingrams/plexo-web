// Gives a site its shared header and footer without the owner designing anything first — the same
// "works out of the box" idea as ensureStorefrontLayout / ensureProductDetailLayout. The defaults
// carry the site's name, a Home link (and the shop when there is one); the owner restyles them in
// the editor like any page, and every page picks the change up. Free of next/server so SOL's
// Lambda bundle and MCP tools can call it.

import { randomUUID } from "node:crypto";

import { SiteLayout, Template } from "@/lib/db/contentEntities";
import { getStorefrontPath } from "@/lib/commerce/storefrontLayout";
import { buildSiteFooterV2, buildSiteHeaderV2 } from "@/lib/v2/layoutDesigns";
import { siteInfo } from "@/lib/v2/siteFormat";
import { recompileSiteLayoutDependents } from "@/lib/siteLayoutCore";
import { fragmentIsBlank, type LayoutKind } from "@/lib/siteLayoutBlank";

export type EnsuredSiteLayout = { enabled: boolean; headerTemplateId: string; footerTemplateId: string };

/**
 * Makes sure a new-editor (V2) site has a header and a footer, and turns the shared layout on.
 *  - A brand-new site (no layout row yet) gets it switched on.
 *  - A site whose owner switched it off stays off unless `turnOn` is set (the owner pressing the switch).
 * Classic sites return null: their header/footer stay the owner's opt-in with the classic builder.
 * Idempotent: existing header/footer designs are never replaced — except a BLANK one (every older site starts with
 * blank ones, lib/siteLayoutBlank.ts) when the owner opts in with `turnOn`: that is "Add a header", so it gets the
 * ready-made default. `fill` limits which of the two is filled (default both).
 */
export async function ensureSiteLayout(
  rootTemplateId: string,
  organizationId: string,
  userId: string,
  opts: { turnOn?: boolean; fill?: LayoutKind[] } = {},
): Promise<EnsuredSiteLayout | null> {
  const site = await siteInfo(rootTemplateId);
  if (site.format !== "v2") return null;

  const { data: existing } = await SiteLayout.get({ templateId: rootTemplateId }).go();
  const shopPath = await getStorefrontPath(rootTemplateId);

  const designFor = (kind: LayoutKind) => (kind === "header" ? buildSiteHeaderV2(site.name, shopPath) : buildSiteFooterV2(site.name, shopPath));
  const make = async (kind: LayoutKind): Promise<string> => {
    const id = randomUUID();
    await Template.create({
      id,
      userId,
      organizationId,
      name: kind === "header" ? "Site Header" : "Site Footer",
      kind: "LANDING_PAGE",
      isSiteLayoutFragment: true,
      designFormat: "v2",
      designJson: designFor(kind),
      compiledHtml: "",
    }).go();
    return id;
  };

  const resolveKind = async (kind: LayoutKind, current: string | null | undefined): Promise<string> => {
    if (!current) return make(kind);
    if (opts.turnOn && (opts.fill ?? ["header", "footer"]).includes(kind) && (await fragmentIsBlank(current))) {
      await Template.patch({ id: current }).set({ designFormat: "v2", designJson: designFor(kind) }).go();
    }
    return current;
  };
  const headerTemplateId = await resolveKind("header", existing?.headerTemplateId);
  const footerTemplateId = await resolveKind("footer", existing?.footerTemplateId);
  const enabled = existing ? (opts.turnOn ? true : !!existing.enabled) : true;

  if (existing) {
    await SiteLayout.patch({ templateId: rootTemplateId }).set({ headerTemplateId, footerTemplateId, enabled, layoutProvisionedAt: existing.layoutProvisionedAt ?? new Date().toISOString() }).go();
  } else {
    await SiteLayout.create({ id: randomUUID(), templateId: rootTemplateId, organizationId, enabled, headerTemplateId, footerTemplateId, layoutProvisionedAt: new Date().toISOString() }).go();
  }
  await recompileSiteLayoutDependents(rootTemplateId);
  return { enabled, headerTemplateId, footerTemplateId };
}
