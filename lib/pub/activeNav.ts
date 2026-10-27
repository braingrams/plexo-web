// "You are here" in site menus. A visitor on /about should see the About link marked in the menu. This marks the
// link for the current page with aria-current="page" (what screen readers announce, and what CSS can style) in
// every <nav> of a published page — builder pages, raw uploads alike — and gives the editor's own menus a default
// look for it. A site that already marks its own active link (aria-current, or an "active"/"current" class) is left
// exactly as it is.

const NAV_RE = /<nav\b[^>]*>[\s\S]*?<\/nav>/gi;
const ANCHOR_RE = /<a\b([^>]*)>/gi;

/** "/About/", "/about.html", "/about/index.html?x=1#y" → "/about"; "/" stays "/". */
export function normalizePath(path: string): string {
  let p = path.split(/[?#]/)[0].toLowerCase();
  p = p.replace(/\/index\.html?$/, "/").replace(/\.html?$/, "");
  p = p.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

function pathOfHref(href: string, host: string): string | null {
  const h = href.trim();
  if (!h || h.startsWith("#") || /^(mailto:|tel:|javascript:|sms:)/i.test(h)) return null;
  if (h.startsWith("//")) return null;
  if (/^https?:\/\//i.test(h)) {
    try {
      const u = new URL(h);
      return u.hostname.replace(/^www\./, "") === host.replace(/^www\./, "") ? normalizePath(u.pathname) : null;
    } catch {
      return null;
    }
  }
  if (!h.startsWith("/")) return null; // relative links resolve differently per page; leave them
  return normalizePath(h);
}

const hrefOf = (attrs: string): string | null => attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)')/i)?.[2] ?? attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)')/i)?.[3] ?? null;
const hasOwnActive = (nav: string) => /aria-current\s*=/i.test(nav) || /\bclass\s*=\s*["'][^"']*\b(active|current|is-active|current-menu-item|selected)\b/i.test(nav);

/** Marks the best-matching link of each nav: an exact match, else the longest section match (/blog for /blog/my-post). */
export function markActiveNavLinks(html: string, currentPath: string, host: string): string {
  if (!/<nav\b/i.test(html)) return html;
  const here = normalizePath(currentPath);
  return html.replace(NAV_RE, (nav) => {
    if (hasOwnActive(nav)) return nav;
    let best: { index: number; score: number } | null = null;
    let n = 0;
    nav.replace(ANCHOR_RE, (_m, attrs: string, offset: number) => {
      const href = hrefOf(attrs);
      const p = href === null ? null : pathOfHref(href, host);
      if (p !== null) {
        const score = p === here ? 10_000 + p.length : p !== "/" && here.startsWith(p + "/") ? p.length : -1;
        if (score > (best?.score ?? -1)) best = { index: offset, score };
      }
      n++;
      return _m;
    });
    if (!best) return nav;
    // Every link that points at the winning address (a menu has a desktop and a mobile copy of each link).
    const winner = hrefOf(nav.slice((best as { index: number }).index).match(/<a\b([^>]*)>/i)![1]);
    const target = pathOfHref(winner!, host);
    return nav.replace(ANCHOR_RE, (m, attrs: string) => {
      const href = hrefOf(attrs);
      return href !== null && pathOfHref(href, host) === target ? `<a${attrs} aria-current="page">` : m;
    });
  });
}

/** Default look for the active link of the editor's own menus: underlined, like the page you're on. */
export const ACTIVE_NAV_CSS = `.plx-menu a[aria-current="page"]{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:8px}`;

export function applyActiveNav(html: string, currentPath: string, host: string): string {
  let out = markActiveNavLinks(html, currentPath, host);
  if (out !== html && out.includes("plx-menu") && !out.includes("data-plexo-active-nav")) {
    const style = `<style data-plexo-active-nav>${ACTIVE_NAV_CSS}</style>`;
    out = /<\/head\s*>/i.test(out) ? out.replace(/<\/head\s*>/i, `${style}</head>`) : style + out;
  }
  return out;
}
