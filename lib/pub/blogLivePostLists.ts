// Live post lists inside a page or blog layout, drawn in the SITE'S OWN post-card design.
//
// A migrated WordPress page that listed posts (a "Latest news" section, a /blog/ page built
// with Elementor's Loop Grid) is saved with each list replaced by:
//
//   <div style="display:contents" data-plexo-blog-postList="true" data-plexo-blog-count="3" …></div>
//   <template data-plexo-blog-card="true"> …one card from that list, with %%plexo.*%% slots… </template>
//
// (see lib/wpMigration/livePostLists.ts for how the card is turned into a template). At view
// time every such list is filled with the latest real posts, so new posts appear in the
// site's own card design instead of the page showing a frozen copy of 2024's posts.
// display:contents keeps the cards direct children of the theme's grid, as they were.

export interface LivePost {
  url: string;
  title: string;
  excerpt: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  publishedAt: Date | string | null;
  authorName: string | null;
  authorUrl: string | null;
  categoryName: string | null;
  categoryUrl: string | null;
  readingMinutes: number | null;
}

export interface PostListSpec {
  /** How many posts the list showed on WordPress. */
  count: number;
  /** How many of the newest posts it skipped (e.g. a "more news" list under a featured post). */
  offset: number;
  /** Only posts in this category (blog category slug), when the list was limited to one. */
  category: string | null;
  /** The blog listing's own list — filled with the current page of posts, not the latest N. */
  main: boolean;
}

const LIST_RE =
  /<div([^>]*\bdata-plexo-blog-postlist="true"[^>]*)>\s*<\/div>\s*<template\b[^>]*\bdata-plexo-blog-card="true"[^>]*>([\s\S]*?)<\/template>/gi;

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(attrs);
  return m ? m[1] : null;
}

/** Cheap check so pages without live lists pay nothing. */
export function hasLivePostLists(html: string): boolean {
  return /data-plexo-blog-card="true"/i.test(html);
}

export function readPostListSpecs(html: string): PostListSpec[] {
  const specs: PostListSpec[] = [];
  for (const m of html.matchAll(LIST_RE)) specs.push(specFromAttrs(m[1]));
  return specs;
}

function specFromAttrs(attrs: string): PostListSpec {
  const count = Number.parseInt(attr(attrs, "data-plexo-blog-count") ?? "", 10);
  const offset = Number.parseInt(attr(attrs, "data-plexo-blog-offset") ?? "", 10);
  return {
    count: Number.isFinite(count) && count > 0 ? Math.min(count, 48) : 6,
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
    category: attr(attrs, "data-plexo-blog-category") || null,
    main: attr(attrs, "data-plexo-blog-main") === "true",
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** WordPress hands titles and excerpts over HTML-encoded ("R&amp;B", "&#8220;Do Me&#8221;"). */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&hellip;/g, "…")
    .replace(/&amp;/g, "&");
}

/** The first `words` words, with an ellipsis when anything was cut — how WordPress themes shorten excerpts. */
function firstWords(text: string, words: number): string {
  const all = text.trim().split(/\s+/);
  return all.length <= words ? text.trim() : `${all.slice(0, words).join(" ").replace(/[,.;:!?]+$/, "")}…`;
}

/**
 * The card's image takes the shape the site's own card had. WordPress served each card a
 * thumbnail already cropped to it (e.g. 412×274); Plexo shows the full featured image, so
 * a tall photo made a tall card. The template keeps the original width/height, which
 * becomes a fixed aspect ratio with cover cropping.
 */
function keepCardImageShape(html: string): string {
  return html.replace(/<img\b[^>]*%%plexo\.image%%[^>]*>/g, (tag) => {
    const width = Number(/\swidth=["']?(\d+)/i.exec(tag)?.[1]);
    const height = Number(/\sheight=["']?(\d+)/i.exec(tag)?.[1]);
    if (!width || !height || /aspect-ratio/i.test(tag)) return tag;
    const shape = `aspect-ratio:${width} / ${height};object-fit:cover;`;
    return /\sstyle=["']/i.test(tag) ? tag.replace(/\sstyle=(["'])/i, ` style=$1${shape}`) : tag.replace(/^<img\b/i, `<img style="${shape}"`);
  });
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

/** The date in the same format the WordPress site printed it (detected when the card was templated). */
export function formatPostDate(value: Date | string | null, format: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  switch (format) {
    case "dmy": return `${day} ${month} ${year}`;
    case "mdy-short": return `${month.slice(0, 3)} ${day}, ${year}`;
    case "dmy-short": return `${day} ${month.slice(0, 3)} ${year}`;
    case "mdy-ord": return `${month} ${ordinal(day)}, ${year}`;
    case "dmy-ord": return `${ordinal(day)} ${month} ${year}`;
    case "iso": return `${year}-${mm}-${dd}`;
    case "us": return `${mm}/${dd}/${year}`;
    case "eu": return `${dd}/${mm}/${year}`;
    case "eu-dot": return `${dd}.${mm}.${year}`;
    default: return `${month} ${day}, ${year}`; // "mdy" — WordPress's default "F j, Y"
  }
}

/** One card from a template. Unknown values collapse to empty, and image-only parts go when there's no image. */
export function fillCardTemplate(template: string, post: LivePost): string {
  let html = template;
  if (!post.imageUrl) html = html.replace(/<!--plexo-if-image-->[\s\S]*?<!--\/plexo-if-image-->/g, "");
  html = html.replace(/<!--\/?plexo-if-image-->/g, "");
  const excerpt = decodeEntities(post.excerpt ?? "");
  const values: Record<string, string> = {
    url: post.url,
    title: decodeEntities(post.title),
    excerpt,
    image: post.imageUrl ?? "",
    imageAlt: decodeEntities(post.imageAlt ?? ""),
    author: decodeEntities(post.authorName ?? ""),
    authorUrl: post.authorUrl ?? post.url,
    category: decodeEntities(post.categoryName ?? ""),
    categoryUrl: post.categoryUrl ?? post.url,
    readingTime: post.readingMinutes ? String(post.readingMinutes) : "1",
  };
  return keepCardImageShape(html)
    // An excerpt the site's cards cut to a number of words (see deriveCardTemplate).
    .replace(/%%plexo\.excerpt:(\d+)%%/g, (_m, words: string) => escapeHtml(firstWords(excerpt, Number(words))))
    .replace(/%%plexo\.date(?::([a-z-]+))?%%/g, (_m, fmt: string | undefined) => escapeHtml(formatPostDate(post.publishedAt, fmt ?? "mdy")))
    .replace(/%%plexo\.([a-zA-Z]+)%%/g, (whole, key: string) => (key in values ? escapeHtml(values[key]) : whole));
}

/**
 * Fills every live list in `html`. `postsFor` returns the posts for one list (the caller
 * queries the blog); `mainExtra` is appended after the main list (its pagination).
 */
export async function renderLivePostLists(
  html: string,
  postsFor: (spec: PostListSpec) => Promise<LivePost[]>,
  mainExtra = "",
): Promise<string> {
  const matches = Array.from(html.matchAll(LIST_RE));
  if (matches.length === 0) return html;
  const rendered = await Promise.all(
    matches.map(async (m) => {
      const spec = specFromAttrs(m[1]);
      const posts = await postsFor(spec);
      const cards = posts.map((p) => fillCardTemplate(m[2], p)).join("");
      return `<div${m[1]}>${cards}</div>${spec.main ? mainExtra : ""}`;
    }),
  );
  let i = 0;
  return html.replace(LIST_RE, () => rendered[i++]);
}
