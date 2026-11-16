import type { EntityItem } from "electrodb";

import type { ResolvedUser } from "@/lib/mcp/dispatchMcpTool";
import { BlogSite, SiteLayout, Template } from "@/lib/db/contentEntities";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { designFormatOf } from "@/lib/v2/design";

/**
 * find_page: "the shop page", "pricing", "the about page on Crumbs" → the right page, across
 * all of the owner's sites, without them (or SOL) knowing any ids. Covers every kind of page a
 * site has: its pages (visual, classic or hand-written), the pages Plexo makes for selling
 * (shop, checkout, order confirmation, order tracking, the product page every product uses),
 * the blog's listing and article layouts, and the shared menu and footer.
 *
 * rankPages is pure (tested on its own); findPageCandidates reads the account.
 */

export type PageKind =
  | "home" | "page" | "shop" | "checkout" | "order-confirmation" | "track-order" | "product-layout"
  | "blog-listing" | "blog-post-layout" | "site-header" | "site-footer";

export type PageCandidate = {
  templateId: string;
  siteId: string;
  siteName: string;
  name: string;
  /** Where it lives on the site ("/", "/store"), or null for a layout shared by many pages. */
  route: string | null;
  kind: PageKind;
  designFormat: "v2" | "classic" | "raw-html";
};

export type RankedPage = PageCandidate & { score: number };

const STOP = new Set(["the", "a", "an", "my", "our", "your", "page", "pages", "on", "of", "in", "for", "at", "to", "site", "website", "web", "look", "show", "open", "see", "please", "can", "you", "me", "this", "that", "section", "and", "with", "from", "s"]);

const SYNONYMS: string[][] = [
  ["shop", "store", "storefront", "products", "catalog", "catalogue", "merch", "buy", "shopping"],
  ["home", "homepage", "front", "landing", "main", "index", "start"],
  ["about", "story", "us", "who", "mission"],
  ["contact", "reach", "touch", "enquiry", "enquiries", "inquiry"],
  ["pricing", "prices", "price", "plans", "plan", "rates", "packages", "cost"],
  ["blog", "news", "articles", "article", "posts", "post", "journal", "stories"],
  ["checkout", "cart", "basket", "bag"],
  ["confirmation", "confirmed", "thanks", "thank", "receipt", "success"],
  ["track", "tracking", "delivery", "shipping"],
  ["menu", "header", "navigation", "nav", "top", "navbar"],
  ["footer", "bottom"],
  ["product", "item", "detail", "details"],
  ["faq", "faqs", "questions", "help"],
  ["gallery", "portfolio", "work", "projects", "photos"],
  ["services", "service", "offerings", "offering", "treatments"],
  ["team", "people", "staff"],
  ["reviews", "testimonials", "review"],
];
const GROUP = new Map<string, number>();
SYNONYMS.forEach((words, i) => words.forEach((w) => GROUP.set(w, i)));

const KIND_TERMS: Record<PageKind, string> = {
  home: "home", page: "", shop: "shop store", checkout: "checkout cart", "order-confirmation": "order confirmation", "track-order": "track order",
  "product-layout": "product page", "blog-listing": "blog", "blog-post-layout": "blog post article", "site-header": "header menu", "site-footer": "footer",
};

const tokens = (s: string): string[] => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
const singular = (t: string) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);

function termScore(q: string, terms: string[]): number {
  let best = 0;
  for (const t of terms) {
    if (t === q || singular(t) === singular(q)) return 3;
    const g = GROUP.get(q) ?? GROUP.get(singular(q));
    if (g !== undefined && (GROUP.get(t) === g || GROUP.get(singular(t)) === g)) best = Math.max(best, 2.5);
    else if (q.length >= 3 && t.startsWith(q)) best = Math.max(best, 1.5);
  }
  return best;
}

/**
 * Scores every candidate against what the owner said. Words naming a site ("on Crumbs") narrow
 * it to that site; the rest are matched against each page's name, address and what it is.
 */
export function rankPages(query: string, candidates: PageCandidate[]): RankedPage[] {
  const words = tokens(query);
  const siteTerms = new Map(candidates.map((c) => [c.siteId, tokens(c.siteName)]));
  const siteWords = new Set<string>();
  for (const w of words) for (const terms of siteTerms.values()) if (terms.includes(w)) siteWords.add(w);
  const pageWords = words.filter((w) => !STOP.has(w) && !siteWords.has(w));
  const mentionedSites = new Set([...siteTerms].filter(([, terms]) => terms.some((t) => siteWords.has(t))).map(([id]) => id));

  return candidates
    .map((c) => {
      const terms = [...tokens(c.name), ...tokens(c.route ?? ""), ...tokens(KIND_TERMS[c.kind])];
      // No page words ("my site", "Crumbs") means the home page.
      let score = pageWords.length ? pageWords.reduce((sum, w) => sum + termScore(w, terms), 0) / pageWords.length : c.kind === "home" ? 2 : 0;
      if (score > 0 && mentionedSites.has(c.siteId)) score += 1;
      if (score > 0 && mentionedSites.size && !mentionedSites.has(c.siteId)) score -= 1;
      // A real page beats a layout with the same words ("blog" → the blog listing, not the article layout).
      if (score > 0 && (c.kind === "page" || c.kind === "home" || c.kind === "shop" || c.kind === "blog-listing")) score += 0.1;
      return { ...c, score: Math.round(score * 100) / 100 };
    })
    .filter((c) => c.score > 0.5)
    .sort((a, b) => b.score - a.score || (a.route ?? "~").localeCompare(b.route ?? "~"));
}

/** The best match, or the tied ones when it's genuinely unclear (same score on different pages). */
export function pickPage(ranked: RankedPage[]): { match: RankedPage | null; tied: RankedPage[] } {
  if (!ranked.length) return { match: null, tied: [] };
  const top = ranked.filter((r) => r.score >= ranked[0].score - 0.05);
  return top.length === 1 ? { match: top[0], tied: [] } : { match: null, tied: top };
}

// ------------------------------------------------------------------ reading the account

type Row = EntityItem<typeof Template>;

function formatOf(row: Row): PageCandidate["designFormat"] {
  if (row.sourceType === "RAW_UPLOAD") return "raw-html";
  return designFormatOf(row) === "v2" ? "v2" : "classic";
}

/** Every page of every site in the organisation (bounded), plus the shared layouts each site uses. */
export async function findPageCandidates(resolved: ResolvedUser, siteId?: string): Promise<PageCandidate[]> {
  const { data: rows } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all" });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const isSitePage = (r: Row) => r.kind === "LANDING_PAGE" && r.sourceType !== "REACT_PROJECT" && !r.isSiteLayoutFragment && !r.isBlogLayout && !r.isCommerceLayout;
  const roots = rows.filter((r) => isSitePage(r) && !r.parentId && (!siteId || r.id === siteId)).slice(0, 60);
  const rootIds = new Set(roots.map((r) => r.id));

  const rootOf = (r: Row): string | null => {
    let cur: Row | undefined = r;
    for (let i = 0; cur && i < 20; i++) {
      if (!cur.parentId) return cur.id;
      cur = byId.get(cur.parentId);
    }
    return null;
  };
  const pathOf = (r: Row): string => {
    const segs: string[] = [];
    let cur: Row | undefined = r;
    for (let i = 0; cur?.parentId && i < 20; i++) {
      segs.unshift(cur.slug ?? "");
      cur = byId.get(cur.parentId);
    }
    return segs.length ? `/${segs.join("/")}` : "/";
  };

  const out: PageCandidate[] = [];
  for (const r of rows) {
    if (!isSitePage(r)) continue;
    const root = rootOf(r);
    if (!root || !rootIds.has(root)) continue;
    out.push({ templateId: r.id, siteId: root, siteName: byId.get(root)?.name ?? "", name: r.name, route: pathOf(r), kind: r.parentId ? "page" : "home", designFormat: formatOf(r) });
  }

  // What each page is for (the shop, checkout…) and the layouts shared by many pages.
  await Promise.all(
    roots.map(async (root) => {
      const [{ data: commerce }, { data: blog }, { data: layout }] = await Promise.all([
        CommerceSettings.get({ templateId: root.id }).go(),
        BlogSite.get({ templateId: root.id }).go(),
        SiteLayout.get({ templateId: root.id }).go(),
      ]);
      const mark = (id: string | null | undefined, kind: PageKind) => {
        const hit = id ? out.find((c) => c.templateId === id) : undefined;
        if (hit) hit.kind = kind;
      };
      mark(commerce?.storefrontTemplateId, "shop");
      mark(commerce?.storefrontCheckoutTemplateId, "checkout");
      mark(commerce?.orderConfirmationTemplateId, "order-confirmation");
      mark(commerce?.trackOrderTemplateId, "track-order");
      const shared: Array<[string | null | undefined, PageKind, string, string | null]> = [
        [commerce?.productDetailTemplateId, "product-layout", "Product page (used by every product)", null],
        [blog?.listingLayoutTemplateId, "blog-listing", "Blog", "/blog"],
        [blog?.postLayoutTemplateId, "blog-post-layout", "Blog post page (used by every post)", null],
        [layout?.enabled ? layout.headerTemplateId : null, "site-header", "Menu at the top (every page)", null],
        [layout?.enabled ? layout.footerTemplateId : null, "site-footer", "Footer (every page)", null],
      ];
      for (const [id, kind, name, route] of shared) {
        const row = id ? byId.get(id) : undefined;
        if (row) out.push({ templateId: row.id, siteId: root.id, siteName: root.name, name, route, kind, designFormat: formatOf(row) });
      }
    }),
  );
  return out;
}

/** What to call to change a page of this kind (for the AI; it never shows these words to the owner). */
export function howToChange(c: PageCandidate): string {
  if (c.kind === "blog-listing" || c.kind === "blog-post-layout") return `Change it with blog_layout_edit (templateId ${c.siteId}, kind "${c.kind === "blog-listing" ? "listing" : "post"}"); it takes effect at once.`;
  if (c.designFormat === "raw-html") return "It's hand-written HTML: change it with update_raw_landing_page (whole page), or rebuild it in the visual editor with page_create_from_template.";
  if (c.designFormat === "classic") return "It's a classic-editor page: change it with update_template.";
  if (c.kind === "site-header" || c.kind === "site-footer") return "It's shared by every page: change it with page_edit (this templateId) then page_publish; every page picks it up.";
  return "Change it with page_edit (this templateId), then page_publish to put it live.";
}
