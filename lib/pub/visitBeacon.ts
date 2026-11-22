import { escapeHtmlAttr, insertBeforeBodyEnd } from "@/lib/pub/htmlInject";

/**
 * Counting visits without depending on the server rendering the page.
 *
 * Published pages are cached at the edge (see PAGE_CACHE_CONTROL), so most visits never reach the server that renders
 * them. Counting on render would therefore undercount, more the busier the site is. Instead every page carries a tiny
 * first-party script that sends one small request to the site's own address (/__plexo/v) when the page is opened. That
 * request is never cached, so the count is the same whether the page came from the edge or from the server.
 *
 * - It is the ONLY place a page view is recorded (the server no longer counts on render), so a visit is never counted twice.
 * - It is separate from Google Analytics: the Google tag is untouched, and Google's numbers stay Google's numbers.
 * - No cookies and no browser storage. When the visitor's country needs consent (lib/consent/regions.ts), or the browser
 *   says "do not track", the visit is still counted but with no visitor fingerprint (see app/api/public/visit).
 */

/** Sent with every page. The edge keeps a copy for a minute (and serves it while refreshing for five more); browsers always ask again. */
export const PAGE_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
/** Never cached anywhere: used for pages that could differ per visitor. */
export const PAGE_NO_STORE = "no-store";

export const VISIT_BEACON_PATH = "/__plexo/v";

export function visitBeaconScript(pageId: string): string {
  // `g` = the browser asks not to be tracked (Global Privacy Control / Do Not Track). `r` = arrived from another site.
  const id = JSON.stringify(pageId).replace(/</g, "\\u003c");
  return `(function(){try{var n=navigator;if(n.webdriver)return;var b=JSON.stringify({p:${id},g:(n.globalPrivacyControl||n.doNotTrack==="1")?1:0,r:document.referrer&&document.referrer.indexOf(location.origin)!==0?1:0});var u="${VISIT_BEACON_PATH}";var s=function(){if(n.sendBeacon){n.sendBeacon(u,new Blob([b],{type:"text/plain"}))}else{fetch(u,{method:"POST",body:b,keepalive:true,headers:{"content-type":"text/plain"}})}};if(document.prerendering){document.addEventListener("prerenderingchange",s,{once:true})}else{s()}}catch(e){}})();`;
}

/** Adds the counting script before the end of the page. A page already carrying it is left alone. */
export function injectVisitBeacon(html: string, pageId: string): string {
  if (html.includes(VISIT_BEACON_PATH)) return html;
  return insertBeforeBodyEnd(html, `<script data-plexo-visit="${escapeHtmlAttr(pageId)}">${visitBeaconScript(pageId)}</script>`);
}
