// Client-safe (no DB imports) — used by both the editor's Preview modal and text-content route.

/** Inserts <base href> at the top of <head> (or the document) unless the page already sets one. */
export function injectBaseHref(html: string, href: string | null | undefined): string {
  if (!href || /<base\s/i.test(html)) return html;
  const tag = `<base href="${href.replace(/"/g, "&quot;")}">`;
  return /<head(\s[^>]*)?>/i.test(html) ? html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}${tag}`) : `${tag}${html}`;
}
