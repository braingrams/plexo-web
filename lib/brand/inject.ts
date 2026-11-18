import { escapeHtmlAttr } from "@/lib/pub/htmlInject";
import { applyBrandMappingToCss, applyBrandMappingToHtml, type BrandMapping } from "./mapping";
import { brandForServing } from "./siteBrand";
import { brandSheetPath } from "./store";

// Serve-time brand for every kind of published page: a <link> to the site's hosted brand sheet, plus — for raw-HTML and
// WordPress pages whose owner chose "Use my brand on this site" — their own colours and fonts pointed at the brand's variables.

export const BRAND_LINK_ATTR = "data-plexo-brand";

/**
 * The <link> tag. `?v=<revision>` is what makes a brand change show within the page's own short cache: a new revision is a new
 * address. `stable: true` leaves it off — for HTML cached for a long time (deployed static sites, an hour at the edge), where the
 * sheet's own short cache has to carry the change instead.
 */
export function brandLinkTag(siteId: string, revision: string, opts: { stable?: boolean } = {}): string {
  const href = opts.stable ? brandSheetPath(siteId) : `${brandSheetPath(siteId)}?v=${encodeURIComponent(revision)}`;
  return `<link rel="stylesheet" href="${escapeHtmlAttr(href)}" ${BRAND_LINK_ATTR}>`;
}

/** Puts the link at the end of <head> (after the page's own styles; the sheet wins on specificity either way). Never twice. */
export function insertBrandLink(html: string, tag: string): string {
  if (html.includes(BRAND_LINK_ATTR)) return html;
  const masked = html.replace(/<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>/gi, (b) => " ".repeat(b.length));
  const headEnd = masked.search(/<\/head\s*>/i);
  if (headEnd !== -1) return html.slice(0, headEnd) + tag + html.slice(headEnd);
  const bodyOpen = /<body\b[^>]*>/i.exec(masked);
  if (bodyOpen) return html.slice(0, bodyOpen.index) + tag + html.slice(bodyOpen.index);
  return tag + html;
}

export type PageKind = "v2" | "raw" | "app" | "deployed-static" | "classic";

/**
 * The brand for one served HTML page. V2 pages, apps and deployed sites get the link; raw/WordPress pages get it only when their
 * colours and fonts are mapped to the brand (otherwise nothing on the page would use it). Classic-editor pages don't use brand
 * variables, so they're left alone. Never throws: a page is always served, branded or not.
 */
export async function applySiteBrandToHtml(html: string, siteId: string, kind: PageKind): Promise<string> {
  if (kind === "classic") return html;
  try {
    const brand = await brandForServing(siteId);
    if (!brand) return html;
    let out = html;
    if (kind === "raw") {
      if (!brand.mapping) return html;
      out = applyBrandMappingToHtml(out, brand.mapping as BrandMapping);
    }
    return insertBrandLink(out, brandLinkTag(siteId, brand.revision, { stable: kind === "deployed-static" }));
  } catch (err) {
    console.warn(`[site-brand] ${siteId}: serving without the brand`, err);
    return html;
  }
}

/** A raw/WordPress site's own stylesheet with its colours and fonts pointed at the brand (or untouched when that's off). */
export async function applySiteBrandToCss(css: string, siteId: string): Promise<string> {
  try {
    const brand = await brandForServing(siteId);
    return brand?.mapping ? applyBrandMappingToCss(css, brand.mapping as BrandMapping) : css;
  } catch {
    return css;
  }
}
