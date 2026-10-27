import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { makePostListsLive, markPostRegionsByContent, type KnownPost } from "./livePostLists";

// A migrated blog keeps the WordPress site's look. Posts move into Plexo's own Blog (so the
// owner can edit and add them), and these turn the WordPress theme's own blog pages into
// Plexo blog LAYOUTS: the page exactly as WordPress rendered it — header, footer, fonts,
// colours, sidebars — with the post-specific parts swapped for the slots Plexo fills with
// the real post / the live post list (lib/pub/blogLayoutRender.ts's markers).
//
// Every input here is HTML that has ALREADY been through htmlTransform.transformPage, so its
// asset links, forms and search already point at Plexo. Nothing here fetches anything.

const marker = (name: string, inline = false) =>
  inline ? `<div style="display:inline" data-plexo-blog-${name}="true"></div>` : `<div data-plexo-blog-${name}="true"></div>`;

// Everything search engines read from <head> is generated per post / per listing by the
// blog routes (lib/blog/seo.ts) — the copy captured from one WordPress page must not leak
// that one page's title, description, canonical URL or structured data into every post.
function stripPageSeo($: CheerioAPI): void {
  $("title").remove();
  $('meta[name="description"], meta[name="robots"], meta[name="keywords"]').remove();
  $('meta[property^="og:"], meta[property^="article:"], meta[name^="twitter:"]').remove();
  $('link[rel="canonical"], link[rel="shortlink"], link[rel="alternate"], link[rel="prev"], link[rel="next"]').remove();
  $('script[type="application/ld+json"]').remove();
}

/** First match of any selector inside `scope`, in priority order (not document order). */
function firstMatch($: CheerioAPI, scope: Cheerio<AnyNode>, selectors: string[]): Cheerio<Element> | null {
  for (const selector of selectors) {
    const found = scope.find(selector).first();
    if (found.length > 0) return found as Cheerio<Element>;
  }
  return null;
}

/** Puts a marker in place of a region's contents, keeping the region's own wrapper (and so its styling). */
function fill($: CheerioAPI, region: Cheerio<Element>, html: string): void {
  // Elementor widgets keep their spacing/background on .elementor-widget-container.
  const container = region.children(".elementor-widget-container").first();
  (container.length > 0 ? container : region).html(html);
}

const POST_SCOPES = [
  '[data-elementor-type="single-post"]',
  '[data-elementor-type="single"]',
  "article.type-post",
  "article.post",
  "main",
  "#main",
  "#primary",
  ".site-main",
];

const POST_REGIONS = {
  title: [".elementor-widget-theme-post-title", ".wp-block-post-title", "h1.entry-title", ".entry-title", "h1.post-title", ".post-title"],
  content: [".elementor-widget-theme-post-content", ".wp-block-post-content", ".entry-content", ".post-content", ".article-content"],
  featuredImage: [".elementor-widget-theme-post-featured-image", ".wp-block-post-featured-image", ".post-thumbnail", ".featured-image", ".entry-thumbnail"],
  date: [".wp-block-post-date", ".posted-on", ".entry-date", "time.published"],
  author: [".wp-block-post-author", ".wp-block-post-author-name", ".byline", ".author.vcard"],
  categories: [".wp-block-post-terms", ".cat-links", ".post-categories"],
  comments: [".elementor-widget-post-comments", ".wp-block-comments", "#comments", ".comments-area"],
};

// Prev/next links and "related posts" carousels point at specific old posts — a frozen
// copy would show the same two links under every post.
const POST_STATIC_LEFTOVERS = [
  ".elementor-widget-post-navigation",
  ".post-navigation",
  ".wp-block-post-navigation-link",
  ".nav-links",
  ".navigation.post-navigation",
];

export interface PostLayoutResult {
  html: string;
  /** Whether WordPress showed comments under posts — the blog mirrors it. */
  hasComments: boolean;
}

/**
 * The theme's single-post page → a post layout. null when the post's content area can't
 * be found (an unusual theme) — the caller falls back to {@link shellLayout}.
 */
export function postLayoutFromWpHtml(html: string, post?: KnownPost): PostLayoutResult | null {
  const $ = cheerio.load(html);
  const scope = firstMatch($, $("body"), POST_SCOPES) ?? $("body");

  const content = firstMatch($, scope, POST_REGIONS.content);
  if (!content) return null;
  // First, so nothing below can match inside the post body being replaced.
  fill($, content, marker("content"));

  for (const selector of POST_STATIC_LEFTOVERS) scope.find(selector).remove();

  const found = new Set<string>(["content"]);
  // The date and author often share one "meta" line (Elementor's Post Info widget, or a
  // classic theme's .entry-meta) — fill it with both rather than lose one.
  const elementorInfo = scope.find(".elementor-widget-post-info").first() as Cheerio<Element>;
  if (elementorInfo.length > 0) {
    fill($, elementorInfo, `${marker("date", true)} ${marker("author", true)}`);
    found.add("date").add("author");
  }

  const place = (name: keyof typeof POST_REGIONS, inline = false) => {
    if (found.has(name)) return;
    const region = firstMatch($, scope, POST_REGIONS[name]);
    if (region) {
      fill($, region, marker(name, inline));
      found.add(name);
    }
  };
  place("title", true);
  place("featuredImage");
  place("date", true);
  place("author", true);
  if (!found.has("date") && !found.has("author")) {
    const meta = scope.find(".entry-meta").first() as Cheerio<Element>;
    if (meta.length > 0) {
      fill($, meta, `${marker("date", true)} ${marker("author", true)}`);
      found.add("date").add("author");
    }
  }
  place("categories");
  place("comments");

  // Builder templates (e.g. an Elementor single-post template made of plain Heading/Image
  // widgets) don't label these — find them by the sample post's own title, image, date, author.
  if (post) {
    for (const name of markPostRegionsByContent($, scope, post, found, marker)) found.add(name);
  }

  stripPageSeo($);
  return { html: $.html(), hasComments: found.has("comments") };
}

const LISTING_SCOPES = ['[data-elementor-type="archive"]', "main", "#main", "#primary", ".site-main", "#content"];
const LOOP_WIDGETS = [".elementor-widget-archive-posts", ".elementor-widget-posts", ".elementor-widget-loop-grid", ".wp-block-query"];
const LOOP_ITEMS = ".elementor-post, .e-loop-item, .wp-block-post, article.type-post, article.post, article.hentry";
const PAGINATION = ".pagination, .nav-links, .posts-navigation, .navigation.pagination, .wp-block-query-pagination, .elementor-pagination";

export interface ListingLayoutResult {
  html: string;
  /** How many posts WordPress listed per page — becomes the blog's posts-per-page. */
  postsShown: number;
  /** The page's own heading ("Our Blog", "News") — becomes the blog's name. */
  title: string;
}

const TITLE_SELECTORS = [".elementor-widget-theme-archive-title", ".page-title", ".archive-title", ".wp-block-query-title", "h1.entry-title", "h1"];

/**
 * The theme's post list (a "posts page", a front page showing latest posts, or an ordinary
 * page with a post-list section such as maildrip.io's /blog/) → a listing layout. Its list
 * becomes a live list in the site's own card design when a card can be templated (see
 * livePostLists.ts), otherwise a slot for Plexo's post cards.
 */
export function listingLayoutFromWpHtml(html: string, posts: KnownPost[] = []): ListingLayoutResult | null {
  const $ = cheerio.load(html);
  const scope = firstMatch($, $("body"), LISTING_SCOPES) ?? $("body");

  // The biggest list on the page is the blog list (sidebars hold the small ones).
  let main: Element | null = null;
  let mainSize = 0;
  scope.find(".elementor-loop-container, .elementor-posts-container, ul.wp-block-post-template").each((_, el) => {
    const size = $(el).children(".e-loop-item, .elementor-post, li.wp-block-post").length;
    if (size > mainSize) [main, mainSize] = [el, size];
  });
  makePostListsLive($, posts, { markMain: (el) => el === main });
  // Lists made live just now, or already live (the migration converts every page's lists).
  const live = $('[data-plexo-blog-postlist="true"]').length;

  const pageTitle = firstMatch($, scope, TITLE_SELECTORS);
  const titleText = pageTitle ? pageTitle.text().replace(/\s+/g, " ").trim() : "";
  if (pageTitle) fill($, pageTitle, marker("heading", true));

  // A list found by its cards rather than a known widget (a site's own posts widget) —
  // the largest live list is the blog list.
  if (live > 0 && $('[data-plexo-blog-main="true"]').length === 0) {
    let biggest: Cheerio<Element> | null = null;
    $('[data-plexo-blog-postlist="true"]').each((_, el) => {
      const count = Number($(el).attr("data-plexo-blog-count") ?? 0);
      if (!biggest || count > Number(biggest.attr("data-plexo-blog-count") ?? 0)) biggest = $(el) as Cheerio<Element>;
    });
    if (biggest) {
      (biggest as Cheerio<Element>).attr("data-plexo-blog-main", "true");
      mainSize = Number((biggest as Cheerio<Element>).attr("data-plexo-blog-count") ?? 0);
    }
  }
  const mainMarker = $('[data-plexo-blog-main="true"]').first();
  if (live > 0 && mainMarker.length > 0) {
    const widget = mainMarker.closest(".elementor-widget, .wp-block-query");
    (widget.length > 0 ? widget : mainMarker.parent()).after(marker("pagination"));
    stripPageSeo($);
    return { html: $.html(), postsShown: mainSize, title: titleText };
  }

  let loop = firstMatch($, scope, LOOP_WIDGETS);
  if (!loop) {
    // Classic themes: the posts are sibling <article>s — their shared parent is the loop.
    const articles = scope.find("article.type-post, article.post, article.hentry");
    const parent = articles.first().parent() as Cheerio<Element>;
    if (articles.length > 0 && parent.length > 0 && articles.toArray().every((a) => a.parent === parent[0])) loop = parent;
  }
  if (!loop) return null;

  const postsShown = loop.find(LOOP_ITEMS).length || scope.find(LOOP_ITEMS).length;
  scope.find(PAGINATION).remove();
  fill($, loop, marker("postList"));
  stripPageSeo($);
  return { html: $.html(), postsShown, title: titleText };
}

const HEADER_SELECTORS = ['[data-elementor-type="header"]', "header#masthead", "header.site-header", "body > header", "header.wp-block-template-part", "header"];
const FOOTER_SELECTORS = ['[data-elementor-type="footer"]', "footer#colophon", "footer.site-footer", "body > footer", "footer.wp-block-template-part"];

/**
 * Fallback for a theme whose blog pages aren't recognisable: any page of the site (its
 * homepage) with everything between its header and footer replaced by a simple, readable
 * post / post-list column — so the blog still wears the site's own header, footer, fonts
 * and colours. null when the page has no recognisable header AND footer.
 */
export function shellLayout(html: string, kind: "post" | "listing", blogTitle: string): string | null {
  const $ = cheerio.load(html);
  const body = $("body");
  const header = firstMatch($, body, HEADER_SELECTORS);
  const footer = firstMatch($, body, FOOTER_SELECTORS) ?? (body.find("footer").last() as Cheerio<Element>);
  if (!header || footer.length === 0) return null;

  const escapedTitle = blogTitle.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const column =
    kind === "post"
      ? `<h1 style="margin:0 0 12px;line-height:1.2;">${marker("title")}</h1>` +
        `<div style="display:flex;gap:12px;opacity:.75;font-size:.95em;margin-bottom:24px;">${marker("date")}${marker("author")}</div>` +
        `<div style="margin-bottom:24px;">${marker("featuredImage")}</div>${marker("content")}` +
        `<div style="margin-top:24px;">${marker("categories")}</div><div style="margin-top:40px;">${marker("comments")}</div>`
      : `<h1 style="margin:0 0 32px;line-height:1.2;">${escapedTitle}</h1>${marker("postList")}`;
  const main = `<main class="plexo-wp-blog" style="max-width:${kind === "post" ? 760 : 1100}px;margin:56px auto;padding:0 20px;">${column}</main>`;

  // Find the header's and footer's nearest shared container, then replace everything
  // strictly between their two branches with the column — keeping any scripts in there
  // (menus, cookie banner) and everything before the header / after the footer.
  const footerChain = new Set<AnyNode>([footer[0], ...footer.parents().toArray()]);
  const common = [header[0], ...header.parents().toArray()].find((n) => footerChain.has(n));
  if (!common) return null;
  const branchOf = (el: Element) => [el, ...$(el).parents().toArray()].find((n) => n.parent === common);
  const kids = $(common).children().toArray();
  const hi = kids.indexOf(branchOf(header[0]) as Element);
  const fi = kids.indexOf(branchOf(footer[0]) as Element);
  if (hi < 0 || fi < 0 || hi >= fi) return null;
  for (const between of kids.slice(hi + 1, fi)) {
    if (between.name === "script") continue;
    $(between).replaceWith($(between).find("script"));
  }
  $(kids[hi]).after(main);
  stripPageSeo($);
  return $.html();
}

/** What WordPress's <body class> says a page is: its posts page and/or its front page. */
export function wpPageRole(rawHtml: string): { isPostsIndex: boolean; isFront: boolean } {
  const match = /<body\b[^>]*\bclass\s*=\s*["']([^"']*)["']/i.exec(rawHtml);
  const classes = new Set((match?.[1] ?? "").split(/\s+/).filter(Boolean));
  return { isPostsIndex: classes.has("blog"), isFront: classes.has("home") };
}
