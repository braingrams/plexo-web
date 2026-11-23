import { normalizeRedirectPath } from "@/lib/redirects/paths";

export type PageForAudit = { name: string; path: string; html: string };
export type BrokenLink = { href: string; pages: string[]; suggestion: string | null };

const HREF = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const FILE_EXT = /\.[a-z0-9]{2,5}$/i;

/** Addresses on the owner's own site that a page links to (no mailto:, other websites, files or #anchors). */
export function internalLinks(html: string, host?: string | null): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(HREF)) {
    let href = (m[1] ?? m[2] ?? "").trim();
    if (!href || /^(mailto:|tel:|sms:|javascript:|data:|#)/i.test(href)) continue;
    if (/^https?:\/\//i.test(href) || href.startsWith("//")) {
      try {
        const u = new URL(href.startsWith("//") ? `https:${href}` : href);
        if (!host || u.hostname.replace(/^www\./, "") !== host.replace(/^www\./, "")) continue;
        href = u.pathname;
      } catch { continue; }
    }
    if (!href.startsWith("/")) continue;
    const path = href.split(/[?#]/)[0];
    if (!path || FILE_EXT.test(path)) continue;
    out.add(path === "/" ? "/" : normalizeRedirectPath(path));
  }
  return [...out];
}

const words = (p: string) => p.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** The existing page whose address shares the most words with a missing one, if any is close. */
export function closestPath(missing: string, existing: string[]): string | null {
  const a = new Set(words(missing));
  let best: { path: string; score: number } | null = null;
  for (const p of existing) {
    if (p === "/") continue;
    const b = words(p);
    const shared = b.filter((w) => a.has(w)).length;
    const score = shared / Math.max(a.size, b.length, 1);
    if (shared > 0 && (!best || score > best.score)) best = { path: p, score };
  }
  return best && best.score >= 0.5 ? best.path : null;
}

/**
 * Links that go nowhere: not a page of the site, not a blog address, not a redirect already set up.
 * `servedPrefixes` are paths Plexo serves itself (the blog, the shop) that aren't pages in the tree.
 */
export function findBrokenLinks(pages: PageForAudit[], opts: { redirects: string[]; servedPrefixes: string[]; host?: string | null }): BrokenLink[] {
  const known = new Set(pages.map((p) => (p.path === "/" ? "/" : normalizeRedirectPath(p.path))));
  const redirected = new Set(opts.redirects.map((r) => normalizeRedirectPath(r)));
  const prefixes = opts.servedPrefixes.map((p) => normalizeRedirectPath(p));
  const broken = new Map<string, Set<string>>();
  for (const page of pages) {
    for (const link of internalLinks(page.html, opts.host)) {
      if (known.has(link) || redirected.has(link)) continue;
      if (prefixes.some((p) => link === p || link.startsWith(`${p}/`))) continue;
      if (!broken.has(link)) broken.set(link, new Set());
      broken.get(link)!.add(page.name);
    }
  }
  const existing = [...known];
  return [...broken.entries()]
    .map(([href, on]) => ({ href, pages: [...on].slice(0, 8), suggestion: closestPath(href, existing) }))
    .sort((x, y) => y.pages.length - x.pages.length || x.href.localeCompare(y.href));
}
