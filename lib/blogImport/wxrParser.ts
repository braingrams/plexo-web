import { XMLParser } from "fast-xml-parser";

export interface WxrAuthor {
  login: string;
  displayName: string;
}

export interface WxrTermRef {
  name: string;
}

export interface WxrPost {
  postId: string;
  title: string;
  link: string;
  authorLogin: string;
  contentHtml: string;
  excerptHtml: string;
  // WXR's own format ("2023-04-04 12:00:00", space-separated, no timezone — always GMT).
  postDateGmt: string;
  slug: string;
  categories: WxrTermRef[];
  tags: WxrTermRef[];
  featuredImageUrl: string | null;
}

export interface ParsedWxr {
  authors: WxrAuthor[];
  posts: WxrPost[];
}

// fast-xml-parser only returns an array when a tag actually repeats more than once in
// the source document — a site with exactly one author/category/postmeta entry would
// otherwise hand back a bare object instead of a one-item array. None of these tag
// names are reused elsewhere in a WXR file's structure, so forcing by bare tag name
// (rather than a full jPath, which this parser version types as string | MatcherView)
// is unambiguous and keeps every access below array-shaped regardless of count.
const FORCE_ARRAY_TAG_NAMES = new Set(["item", "wp:author", "category", "wp:postmeta"]);

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function str(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return "";
  return String(value).trim();
}

function attr(node: unknown, name: string): string {
  return node && typeof node === "object" ? str((node as Record<string, unknown>)[`@_${name}`]) : "";
}

function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return str(node);
  if (node && typeof node === "object" && "#text" in (node as Record<string, unknown>)) {
    return str((node as Record<string, unknown>)["#text"]);
  }
  return "";
}

/**
 * Parses a WordPress "Tools > Export" WXR file (RSS 2.0 + WordPress's own namespaced
 * extensions) into just what the importer needs: published posts (pages/attachments/nav
 * items are out of scope, same as the REST importer), their categories/tags, resolved
 * featured-image URL (via the _thumbnail_id postmeta -> matching attachment item), and
 * the site's author list for login -> display-name mapping.
 */
export function parseWxr(xml: string): ParsedWxr {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    trimValues: true,
    isArray: (tagName) => FORCE_ARRAY_TAG_NAMES.has(tagName),
  });

  const doc = parser.parse(xml) as Record<string, any>;
  const channel = doc?.rss?.channel;
  if (!channel) {
    throw new Error("This doesn't look like a WordPress export file (missing <rss><channel>).");
  }

  const authors: WxrAuthor[] = asArray(channel["wp:author"]).map((a: Record<string, unknown>) => ({
    login: text(a["wp:author_login"]),
    displayName: text(a["wp:author_display_name"]) || text(a["wp:author_login"]),
  }));

  const rawItems = asArray(channel.item);

  const attachmentUrlById = new Map<string, string>();
  for (const item of rawItems) {
    if (text(item["wp:post_type"]) === "attachment") {
      const id = text(item["wp:post_id"]);
      const url = text(item["wp:attachment_url"]);
      if (id && url) attachmentUrlById.set(id, url);
    }
  }

  const posts: WxrPost[] = [];
  for (const item of rawItems) {
    if (text(item["wp:post_type"]) !== "post" || text(item["wp:status"]) !== "publish") continue;

    const rawTerms = asArray(item.category);
    const categories = rawTerms.filter((c) => attr(c, "domain") === "category").map((c) => ({ name: text(c) }));
    const tags = rawTerms.filter((c) => attr(c, "domain") === "post_tag").map((c) => ({ name: text(c) }));

    const postmeta = asArray(item["wp:postmeta"]);
    const thumbnailMeta = postmeta.find((m) => text(m["wp:meta_key"]) === "_thumbnail_id");
    const featuredImageUrl = thumbnailMeta ? attachmentUrlById.get(text(thumbnailMeta["wp:meta_value"])) ?? null : null;

    const postId = text(item["wp:post_id"]);
    if (!postId) continue;

    posts.push({
      postId,
      title: text(item.title) || "Untitled",
      link: text(item.link),
      authorLogin: text(item["dc:creator"]),
      contentHtml: text(item["content:encoded"]),
      excerptHtml: text(item["excerpt:encoded"]),
      postDateGmt: text(item["wp:post_date_gmt"]),
      slug: text(item["wp:post_name"]) || `post-${postId}`,
      categories,
      tags,
      featuredImageUrl,
    });
  }

  return { authors, posts };
}

/** WXR's "2023-04-04 12:00:00" -> a Date-parseable ISO string. */
export function wxrDateToIso(wxrDateGmt: string): string | null {
  if (!wxrDateGmt) return null;
  return `${wxrDateGmt.replace(" ", "T")}Z`;
}
