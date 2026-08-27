import * as cheerio from "cheerio";

/**
 * Strips every <noscript> block before it reaches a preview that deliberately never runs
 * page JS (see forceRevealAnimationsForPreview's doc comment — the Text Content editor's
 * live-DOM-sync needs allow-same-origin, which requires dropping allow-scripts; the Detail
 * page's preview strips <script> outright for the same "passive display surface" reason).
 * A real visitor with JS enabled never sees <noscript> content — a browser only renders it
 * when script genuinely didn't run, which is exactly this preview's own condition. Left in
 * place, that surfaces no-JS fallback markup as if it were the page's normal state — the
 * concrete case this was written for: a mobile nav that's normally `display:none` and
 * opened only via a JS click handler, with a `<noscript><style>.mobile-nav{display:flex
 * !important}</style></noscript>` affordance so navigation still works without JS — which,
 * without this, renders permanently open in every script-free preview.
 */
export function stripNoscriptForPreview(html: string): string {
  const $ = cheerio.load(html);
  if ($("noscript").length === 0) return html;
  $("noscript").remove();
  return $.html();
}
