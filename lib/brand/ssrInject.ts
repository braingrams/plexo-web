import { BRAND_LINK_ATTR, brandLinkTag, insertBrandLink } from "./inject";
import { brandForServing } from "./siteBrand";

// The brand for a DEPLOYED SERVER APP. The owner's own code renders its pages, so nothing in the app mentions the brand; the
// serve layer (lib/pub/serveDeployedSsr.ts) adds the <link> to the hosted sheet to the page it relays, so the brand reaches the
// app without the owner touching code. Responses there are already read in full before they are relayed (the app's output is
// re-wrapped, with its length and encoding headers dropped), so this adds one string insert, and nothing is buffered that wasn't.
//
// Conservative on purpose. The link is left out when:
//   - the response isn't a full HTML page (JSON, RSC payloads, htmx fragments, redirects, empty bodies, HEAD);
//   - the page is larger than MAX_HTML_BYTES (bounded work);
//   - the app already links the sheet itself (the old opt-in) or carries the marker twice;
//   - the app opts out with <meta name="plexo-brand" content="off">;
//   - the page sets its own CSP in a <meta> tag (a stylesheet link could be blocked; the owner's rule wins);
//   - the site isn't linked to a brand, or the owner hasn't switched on "add my brand to my app's pages" (new flag, absent = off for
//     every site that existed before it; deliberately NOT today's "Use my brand on this site", which existing apps already have on);
//   - BRAND_SERVER_INJECT=off is set (global kill switch, no deploy of data);
//   - anything at all goes wrong: it fails open and the page is served exactly as the app produced it.

/** Pages bigger than this are relayed untouched. */
export const MAX_HTML_BYTES = 2 * 1024 * 1024;

export const SSR_BRAND_OPT_OUT = /<meta\b[^>]*\bname\s*=\s*["']?plexo-brand["']?[^>]*\bcontent\s*=\s*["']?off\b|<meta\b[^>]*\bcontent\s*=\s*["']?off["']?[^>]*\bname\s*=\s*["']?plexo-brand\b/i;
const META_CSP = /<meta\b[^>]*\bhttp-equiv\s*=\s*["']?content-security-policy\b/i;
const LINKS_SHEET = /\/__plexo\/brand\/[A-Za-z0-9_-]+\.css/;
const FULL_DOCUMENT = /<!doctype\s+html|<html[\s>]|<head[\s>]/i;

/** Whether a relayed response is the kind of thing the brand link belongs in. Status and content type only; the body is checked next. */
export function isBrandableResponse(input: { status: number; contentType: string | null; method?: string; byteLength?: number }): boolean {
  if (input.method === "HEAD") return false;
  if (input.status < 200 || input.status === 204 || input.status === 205 || input.status === 304 || (input.status >= 300 && input.status < 400)) return false;
  if (!/^\s*text\/html\b/i.test(input.contentType ?? "")) return false;
  if (input.byteLength !== undefined && (input.byteLength === 0 || input.byteLength > MAX_HTML_BYTES)) return false;
  return true;
}

/** Pure: the page with the brand link in its <head>, or the page itself when the link doesn't belong. Idempotent. */
export function addBrandLinkToAppHtml(html: string, tag: string): string {
  if (!FULL_DOCUMENT.test(html)) return html;
  if (html.includes(BRAND_LINK_ATTR) || LINKS_SHEET.test(html)) return html;
  if (SSR_BRAND_OPT_OUT.test(html) || META_CSP.test(html)) return html;
  return insertBrandLink(html, tag);
}

/** The relayed page of a server app, with the site's brand link when it applies. Never throws. */
export const serverInjectKilled = (): boolean => (process.env.BRAND_SERVER_INJECT ?? "").trim().toLowerCase() === "off";

export async function applyBrandToAppResponse(
  body: Uint8Array,
  siteId: string,
  response: { status: number; contentType: string | null; method?: string },
): Promise<Uint8Array> {
  try {
    if (serverInjectKilled()) return body;
    if (!isBrandableResponse({ ...response, byteLength: body.byteLength })) return body;
    const brand = await brandForServing(siteId);
    if (!brand || !brand.serverInject) return body;
    const html = new TextDecoder("utf-8", { fatal: true }).decode(body);
    // Stable address (no ?v=): the page may be cached; the sheet's own short cache carries a brand change, like deployed static sites.
    const out = addBrandLinkToAppHtml(html, brandLinkTag(siteId, brand.revision, { stable: true }));
    return out === html ? body : new TextEncoder().encode(out);
  } catch (err) {
    console.warn(`[site-brand] ${siteId}: serving the app without the brand`, err);
    return body;
  }
}
