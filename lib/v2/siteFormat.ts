import { compileTemplate } from "@/lib/compileTemplate";
import { SiteLayout, Template } from "@/lib/db/contentEntities";
import { fragmentIsBlank } from "@/lib/siteLayoutBlank";
import { getEnabledSiteLayoutRows, layoutSectionsOf, spliceLayoutRows } from "@/lib/siteLayoutCore";
import { designFormatOf, type DesignFormat } from "@/lib/v2/design";
import type { ChromeOptions } from "@/lib/v2/layoutDesigns";
import { compileToHTML } from "@/lib/compiler";
import { sanitizeHtml } from "@/server/sanitizer";

/**
 * Helpers shared by every generator that has to pick V1 or V2 for a site (storefront,
 * product page, blog layouts, funnel starter, header/footer). Deliberately free of
 * `next/server` — SOL's standalone Lambda bundle reaches the commerce generators.
 */

/** The site root's format and name. A missing root counts as a classic (v1) site. */
export async function siteInfo(rootTemplateId: string): Promise<{ format: DesignFormat; name: string }> {
  const { data } = await Template.get({ id: rootTemplateId }).go();
  return { format: designFormatOf(data), name: data?.name?.trim() || "My site" };
}

/**
 * Which of header/footer a generated V2 page must bring itself: a site with a shared
 * header/footer (Site layout) already gets it spliced in at compile time, so the page
 * must not carry a second one.
 */
export async function chromeFor(rootTemplateId: string, siteName: string): Promise<ChromeOptions> {
  const { data: layout } = await SiteLayout.get({ templateId: rootTemplateId }).go();
  const on = !!layout?.enabled;
  // A BLANK shared header/footer (every older site starts with one) shows nothing, so a page must still bring its
  // own — otherwise a new page on an older site would have no menu at all.
  const [headerBlank, footerBlank] = on ? await Promise.all([fragmentIsBlank(layout?.headerTemplateId), fragmentIsBlank(layout?.footerTemplateId)]) : [true, true];
  return { siteName, header: headerBlank, footer: footerBlank };
}

/** Compiles a generated design for either format against the site's current header/footer. */
export async function compileGenerated(
  rootTemplateId: string,
  page: { id: string; name: string; designFormat: DesignFormat; designJson: any },
): Promise<string> {
  const layout = await getEnabledSiteLayoutRows(rootTemplateId);
  if (page.designFormat === "v2") {
    return compileTemplate({ id: page.id, name: page.name, kind: "LANDING_PAGE", designFormat: "v2", designJson: page.designJson }, { rootTemplateId, layout: layoutSectionsOf(layout) });
  }
  return sanitizeHtml(compileToHTML(spliceLayoutRows(page.designJson, layout)));
}
