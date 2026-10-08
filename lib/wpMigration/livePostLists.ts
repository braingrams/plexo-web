import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode, Element, Text } from "domhandler";

// Turns the post lists on a migrated WordPress page into LIVE lists drawn in the site's own
// card design (rendered by lib/pub/blogLivePostLists.ts), and finds the post-specific parts
// of a single-post page.
//
// Page builders rarely label what's in a card: maildrip.io's Elementor Loop Grid cards are
// a generic Heading (the category), Icon List (date, reading time) and Image — nothing says
// "this is the date". But we know exactly which post each card shows (WordPress stamps
// post-<id> on it) and everything about that post, so wherever the card contains THAT
// post's title, link, image, excerpt, date, author or category, that spot becomes a slot.
// Works the same for any theme or builder, and a card we can't confidently template is
// left exactly as it was.

export interface KnownPost {
  wpId: number;
  /** Every form a link to this post can take in migrated HTML (original, root-relative, /blog/<slug>). */
  urls: string[];
  title: string;
  excerpt: string | null;
  /** Featured image file "stem" (name without size suffix/extension), for matching resized copies. */
  imageStem: string | null;
  dateGmt: string | null;
  authorName: string | null;
  categories: { name: string; slug: string }[];
}

const DATE_FORMATS = ["mdy", "dmy", "mdy-short", "dmy-short", "mdy-ord", "dmy-ord", "iso", "us", "eu", "eu-dot"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

/** The post's date written every common WordPress way, most specific first. */
function dateCandidates(iso: string | null): [string, (typeof DATE_FORMATS)[number]][] {
  if (!iso) return [];
  // WordPress prints dates in the site's own timezone; the GMT date can be a day off, so try both neighbours.
  const base = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(base.getTime())) return [];
  const out: [string, (typeof DATE_FORMATS)[number]][] = [];
  for (const shift of [0, 1, -1]) {
    const d = new Date(base.getTime() + shift * 86_400_000);
    const day = d.getUTCDate();
    const m = MONTHS[d.getUTCMonth()];
    const y = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    out.push(
      [`${m} ${ordinal(day)}, ${y}`, "mdy-ord"],
      [`${ordinal(day)} ${m} ${y}`, "dmy-ord"],
      [`${m} ${day}, ${y}`, "mdy"],
      [`${day} ${m} ${y}`, "dmy"],
      [`${m.slice(0, 3)} ${day}, ${y}`, "mdy-short"],
      [`${day} ${m.slice(0, 3)} ${y}`, "dmy-short"],
      [`${y}-${mm}-${dd}`, "iso"],
      [`${mm}/${dd}/${y}`, "us"],
      [`${dd}/${mm}/${y}`, "eu"],
      [`${dd}.${mm}.${y}`, "eu-dot"],
    );
  }
  return out;
}

export function normalizeText(s: string): string {
  return s
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** "Mental-Health-Coach-800x534.webp" / "...-scaled.jpg" → "mental-health-coach". */
export function imageStem(src: string | null | undefined): string | null {
  if (!src) return null;
  const file = decodeURIComponent(src.split(/[?#]/)[0].split("/").pop() ?? "");
  const stem = file
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/\.[a-z0-9]{2,5}$/i, "") // "photo.jpg.webp" (WebP converters)
    .replace(/-\d+x\d+$/, "")
    .replace(/-(scaled|rotated|e\d{10,})$/i, "")
    .toLowerCase();
  return stem || null;
}

function imgSources(img: Element): string[] {
  const a = img.attribs ?? {};
  const out = [a.src, a["data-src"], a["data-lazy-src"], a["data-orig-file"]];
  for (const set of [a.srcset, a["data-srcset"], a["data-lazy-srcset"]]) {
    if (set) out.push(...set.split(",").map((p) => p.trim().split(/\s+/)[0]));
  }
  return out.filter((s): s is string => Boolean(s) && !s.startsWith("data:"));
}

/** True when `src` is the post's featured image — the file itself, a resized copy, or an Elementor crop. */
function isFeaturedImage(src: string, stem: string): boolean {
  const s = imageStem(src);
  if (!s) return false;
  // Elementor's cropped copies live in /uploads/elementor/thumbs/<original-name>-<hash>.<ext>.
  return s === stem || (/\/elementor\/thumbs\//.test(src) && s.startsWith(`${stem}-`));
}

function urlMatches(href: string | undefined, post: KnownPost): boolean {
  if (!href) return false;
  const h = href.replace(/#.*$/, "");
  return post.urls.some((u) => u === h || u.replace(/\/$/, "") === h.replace(/\/$/, ""));
}

function textNodes($: CheerioAPI, root: Cheerio<AnyNode>): Text[] {
  const out: Text[] = [];
  root.find("*").addBack().contents().each((_, n) => {
    if (n.type === "text" && (n as Text).data.trim()) {
      const parentName = (n.parent as Element | null)?.name;
      if (parentName !== "script" && parentName !== "style") out.push(n as Text);
    }
  });
  return out;
}

const UNWANTED_IMG_ATTRS = ["srcset", "sizes", "data-src", "data-srcset", "data-lazy-src", "data-lazy-srcset", "data-lazy-sizes", "data-orig-file", "data-medium-file", "data-large-file"];

/** Wraps an element so it's dropped for posts without that image — up through wrappers holding nothing else. */
function markImageOnly($: CheerioAPI, img: Cheerio<Element>, stopAt: Element): void {
  let target: Cheerio<Element> = img;
  while (true) {
    const parent = target.parent() as Cheerio<Element>;
    if (parent.length === 0 || parent[0] === stopAt) break;
    const significant = parent.contents().filter((_, n) => n.type === "tag" || (n.type === "text" && Boolean((n as Text).data.trim())));
    if (significant.length !== 1) break;
    target = parent;
  }
  target.before("<!--plexo-if-image-->").after("<!--/plexo-if-image-->");
}

/** One rendered card → a reusable card template, or null if we can't confidently tell where its title and link are. */
export function deriveCardTemplate($: CheerioAPI, item: Element, post: KnownPost): string | null {
  const card = $(item).clone() as Cheerio<Element>;
  card.find("noscript, script").remove();

  card.find("a[href]").addBack("a[href]").each((_, node) => {
    const a = node as Element;
    if (urlMatches(a.attribs.href, post)) a.attribs.href = "%%plexo.url%%";
  });

  // Category links — the anchor text is the category's name.
  const categoryNames = new Map(post.categories.map((c) => [normalizeText(c.name), c]));
  card.find("a[href]").each((_, a) => {
    const text = normalizeText($(a).text());
    if (categoryNames.has(text)) {
      a.attribs.href = "%%plexo.categoryUrl%%";
      $(a).text("%%plexo.category%%");
    }
  });

  if (post.imageStem) {
    card.find("img").each((_, img) => {
      if (!imgSources(img).some((s) => isFeaturedImage(s, post.imageStem!))) return;
      for (const name of UNWANTED_IMG_ATTRS) delete img.attribs[name];
      img.attribs.src = "%%plexo.image%%";
      img.attribs.alt = "%%plexo.imageAlt%%";
      markImageOnly($, $(img) as Cheerio<Element>, card[0]);
    });
  }

  const title = normalizeText(post.title);
  const excerptHead = post.excerpt ? normalizeText(post.excerpt).replace(/\s*\[?(\.\.\.|…)\]?$/, "").slice(0, 40) : "";
  const dates = dateCandidates(post.dateGmt);
  let titleDone = false;
  for (const node of textNodes($, card)) {
    const raw = node.data;
    const norm = normalizeText(raw);
    if (!titleDone && norm === title) {
      node.data = raw.replace(raw.trim(), "%%plexo.title%%");
      titleDone = true;
      continue;
    }
    if (excerptHead.length >= 20 && norm.startsWith(excerptHead)) {
      // Cut short on the card (Elementor's excerpt length, a theme's "excerpt_length")? Keep
      // the same number of words, so every card stays the height the site designed.
      const shown = norm.replace(/\s*\[?(\.\.\.|…)\]?$/, "").split(/\s+/).length;
      const full = normalizeText(post.excerpt ?? "").split(/\s+/).length;
      node.data = raw.replace(raw.trim(), shown < full ? `%%plexo.excerpt:${shown}%%` : "%%plexo.excerpt%%");
      continue;
    }
    let data = raw;
    for (const [candidate, format] of dates) {
      if (data.includes(candidate)) {
        data = data.replace(candidate, `%%plexo.date:${format}%%`);
        break;
      }
    }
    if (post.authorName && data.includes(post.authorName)) data = data.replace(post.authorName, "%%plexo.author%%");
    data = data.replace(/\b\d+(\s*(?:min|mins|minute|minutes)\b(?:\s+read)?)/i, "%%plexo.readingTime%%$1");
    node.data = data;
  }

  const html = $.html(card);
  return html.includes("%%plexo.url%%") && html.includes("%%plexo.title%%") ? html : null;
}

// Containers that hold one card per post, and what a card looks like inside each.
const LIST_KINDS = [
  { container: ".elementor-loop-container", item: ".e-loop-item" },
  { container: ".elementor-posts-container", item: ".elementor-post" },
  { container: "ul.wp-block-post-template", item: "li.wp-block-post" },
];
// Controls that page through a list by calling WordPress (AJAX) — they'd do nothing on Plexo.
const LIST_CONTROLS = ".e-load-more-anchor, .e-load-more-spinner, .elementor-pagination, .wp-block-query-pagination, .pagination, .nav-links, .posts-navigation";

function postIdOf(el: Element): number | null {
  const m = /(?:^|\s)(?:post|e-loop-item)-(\d+)(?:\s|$)/.exec(el.attribs?.class ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * Replaces each recognisable post list in a migrated page with a live list. `posts` must be
 * newest-first (the order WordPress lists them). `mainContainer`, when given, marks that
 * one list as the blog listing's main list (filled with the current page of posts).
 */
export function makePostListsLive($: CheerioAPI, posts: KnownPost[], opts: { markMain?: (container: Element) => boolean } = {}): number {
  if (posts.length === 0) return 0;
  const byId = new Map(posts.map((p) => [p.wpId, p]));
  const findPost = (el: Element): KnownPost | undefined => {
    const id = postIdOf(el);
    if (id !== null && byId.has(id)) return byId.get(id);
    const hrefs = $(el).find("a[href]").toArray().map((a) => a.attribs.href);
    return posts.find((p) => hrefs.some((h) => urlMatches(h, p)));
  };

  const containers: { el: Element; items: Element[] }[] = [];
  for (const kind of LIST_KINDS) {
    $(kind.container).each((_, node) => {
      const el = node as Element;
      containers.push({ el, items: $(el).children(kind.item).toArray() as Element[] });
    });
  }
  // Any other theme or widget (classic theme loops, a site's own custom "posts grid"
  // widget): a card is the largest element that links to exactly one post; two or more
  // cards side by side in one parent are a list.
  const known = new Set(containers.map((c) => c.el));
  const postOfHref = (href: string | undefined) => posts.find((p) => urlMatches(href, p));
  const postsLinkedIn = (el: Element) => new Set($(el).find("a[href]").addBack("a[href]").toArray().map((a) => postOfHref((a as Element).attribs.href)).filter(Boolean));
  const cardsByParent = new Map<Element, Set<Element>>();
  $("a[href]").each((_, node) => {
    const a = node as Element;
    if (!postOfHref(a.attribs.href)) return;
    if ($(a).closest("header, footer, nav, [data-plexo-blog-postList]").length > 0) return;
    let card: Element = a;
    while (card.parent && (card.parent as Element).type === "tag" && (card.parent as Element).name !== "body" && postsLinkedIn(card.parent as Element).size === 1) {
      card = card.parent as Element;
    }
    const parent = card.parent as Element | null;
    if (!parent || parent.type !== "tag" || known.has(parent) || containers.some((c) => $(c.el).find(parent).length > 0 || $(parent).find(c.el).length > 0)) return;
    if (!cardsByParent.has(parent)) cardsByParent.set(parent, new Set());
    cardsByParent.get(parent)!.add(card);
  });
  for (const [parent, cards] of cardsByParent) {
    if (cards.size < 2) continue;
    const first = Array.from(cards)[0];
    // Every sibling shaped like the cards counts (cards for posts we don't know about too).
    const shape = `${first.name}.${(first.attribs.class ?? "").trim().split(/\s+/)[0] ?? ""}`;
    const items = $(parent).children().toArray().filter((c) => c.type === "tag" && `${c.name}.${(c.attribs.class ?? "").trim().split(/\s+/)[0] ?? ""}` === shape) as Element[];
    if (items.length >= 2) containers.push({ el: parent, items });
  }

  let lists = 0;
  for (const { el, items } of containers) {
    const mapped = items.map((item) => ({ item, post: findPost(item) })).filter((x): x is { item: Element; post: KnownPost } => Boolean(x.post));
    if (mapped.length === 0) continue;
    let template: string | null = null;
    for (const { item, post } of mapped.slice(0, 3)) {
      template = deriveCardTemplate($, item, post);
      if (template) break;
    }
    if (!template) continue;

    // Limited to one category? Only when every card shares it AND the site has posts outside it.
    let category: string | null = null;
    if (mapped.length >= 2) {
      const shared = mapped[0].post.categories.filter((c) => mapped.every((m) => m.post.categories.some((x) => x.slug === c.slug)));
      const candidate = shared.find((c) => posts.some((p) => !p.categories.some((x) => x.slug === c.slug)));
      if (candidate) category = candidate.slug;
    }
    const pool = category ? posts.filter((p) => p.categories.some((c) => c.slug === category)) : posts;
    const offset = Math.max(0, pool.indexOf(mapped[0].post));
    const main = opts.markMain?.(el) === true;

    const widget = $(el).closest(".elementor-widget-loop-grid, .elementor-widget-posts, .elementor-widget-archive-posts, .wp-block-query");
    (widget.length > 0 ? widget : $(el).parent()).find(LIST_CONTROLS).remove();
    // Elementor "Load more" buttons sit in a wrapper next to the grid.
    widget.children(".elementor-widget-container").children(".elementor-button-wrapper").remove();
    widget.children(".elementor-button-wrapper").remove();

    const attrs = [
      'style="display:contents"',
      'data-plexo-blog-postList="true"',
      `data-plexo-blog-count="${items.length}"`,
      offset ? `data-plexo-blog-offset="${offset}"` : "",
      category ? `data-plexo-blog-category="${category.replace(/"/g, "")}"` : "",
      main ? 'data-plexo-blog-main="true"' : "",
    ].filter(Boolean).join(" ");
    // Anything that isn't a card (Elementor's per-loop <style>) stays.
    const cards = new Set<AnyNode>(items);
    const keep = $(el).children().toArray().filter((child) => !cards.has(child));
    $(el).empty().append(keep).append(`<div ${attrs}></div><template data-plexo-blog-card="true">${template}</template>`);
    lists++;
  }
  return lists;
}

/**
 * Single-post page: marks title / featured image / date / author / categories found by
 * matching the post's own data (for builder templates that don't label them). Only fills
 * regions the caller hasn't already found. Returns which markers it placed.
 */
export function markPostRegionsByContent(
  $: CheerioAPI,
  scope: Cheerio<AnyNode>,
  post: KnownPost,
  already: Set<string>,
  marker: (name: string, inline?: boolean) => string,
): Set<string> {
  const placed = new Set<string>();
  const title = normalizeText(post.title);

  if (!already.has("title")) {
    const heading = scope.find("h1, h2, h3, .elementor-heading-title").filter((_, h) => normalizeText($(h).text()) === title).first();
    if (heading.length > 0) {
      heading.html(marker("title", true));
      placed.add("title");
    }
  }
  if (!already.has("featuredImage") && post.imageStem) {
    const img = scope.find("img").filter((_, i) => imgSources(i).some((s) => isFeaturedImage(s, post.imageStem!))).first();
    if (img.length > 0) {
      img.replaceWith(marker("featuredImage"));
      placed.add("featuredImage");
    }
  }
  const dates = dateCandidates(post.dateGmt);
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  for (const node of textNodes($, scope)) {
    // Split this text into plain parts and markers — date and author often share one line.
    let parts: string[] = [esc(node.data)];
    const splice = (needle: string, name: string) => {
      const escaped = esc(needle);
      const next: string[] = [];
      let done = false;
      for (const part of parts) {
        const i = done || part.startsWith("<div") ? -1 : part.indexOf(escaped);
        if (i < 0) {
          next.push(part);
          continue;
        }
        next.push(part.slice(0, i), marker(name, true), part.slice(i + escaped.length));
        done = true;
      }
      if (done) {
        parts = next;
        placed.add(name);
      }
    };
    if (!already.has("date") && !placed.has("date")) {
      const hit = dates.find(([c]) => node.data.includes(c));
      if (hit) splice(hit[0], "date");
    }
    if (post.authorName && !already.has("author") && !placed.has("author") && node.data.includes(post.authorName)) splice(post.authorName, "author");
    if (parts.length > 1) $(node).replaceWith(parts.join(""));
  }
  return placed;
}
