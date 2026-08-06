export interface WpPost {
  id: number;
  dateGmt: string;
  modifiedGmt: string;
  slug: string;
  link: string;
  status: string;
  title: string;
  contentHtml: string;
  excerptHtml: string;
  featuredMedia: { url: string; alt: string } | null;
  author: { id: number; name: string; avatarUrl?: string } | null;
  categories: { id: number; name: string }[];
  tags: { id: number; name: string }[];
}

/** Ensures a bare host ("example.com") becomes a fetchable absolute URL. */
export function normalizeSiteUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export async function checkWordPressReachable(baseUrl: string): Promise<{ reachable: boolean; totalPosts?: number }> {
  try {
    const url = new URL("/wp-json/wp/v2/posts", normalizeSiteUrl(baseUrl));
    url.searchParams.set("per_page", "1");
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) return { reachable: false };
    const total = res.headers.get("x-wp-total");
    return { reachable: true, totalPosts: total ? Number.parseInt(total, 10) : undefined };
  } catch {
    return { reachable: false };
  }
}

type WpEmbeddedTerm = { id: number; name: string; taxonomy: string };
type WpEmbeddedMedia = { source_url?: string; alt_text?: string; code?: string };
type WpEmbeddedAuthor = { id: number; name: string; avatar_urls?: Record<string, string>; code?: string };
type WpRawPost = {
  id: number;
  date_gmt: string;
  modified_gmt: string;
  slug: string;
  link: string;
  status: string;
  title: { rendered: string };
  content: { rendered: string };
  excerpt: { rendered: string };
  _embedded?: {
    author?: WpEmbeddedAuthor[];
    "wp:featuredmedia"?: WpEmbeddedMedia[];
    "wp:term"?: WpEmbeddedTerm[][];
  };
};

/**
 * One page of a WordPress site's published posts via its public REST API — no auth
 * needed since we're only ever reading what's already public. `_embed=1` pulls
 * featured media, author, and category/tag terms into the same response, avoiding a
 * separate round trip per post per relation.
 */
export async function fetchWordPressPostsPage(
  baseUrl: string,
  page: number,
  perPage = 20,
): Promise<{ posts: WpPost[]; totalPages: number; totalPosts: number }> {
  const url = new URL("/wp-json/wp/v2/posts", normalizeSiteUrl(baseUrl));
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("page", String(page));
  url.searchParams.set("_embed", "1");
  url.searchParams.set("orderby", "id");
  url.searchParams.set("order", "asc");

  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) {
    // WordPress 400s ("rest_post_invalid_page_number") once you page past the end —
    // that's just "no more posts," not a real error.
    if (res.status === 400) return { posts: [], totalPages: Math.max(1, page - 1), totalPosts: 0 };
    throw new Error(`WordPress REST API returned ${res.status} for ${url.toString()}`);
  }

  const totalPagesHeader = res.headers.get("x-wp-totalpages");
  const totalPostsHeader = res.headers.get("x-wp-total");
  const totalPages = totalPagesHeader ? Number.parseInt(totalPagesHeader, 10) : page;
  const totalPosts = totalPostsHeader ? Number.parseInt(totalPostsHeader, 10) : 0;
  const raw = (await res.json()) as WpRawPost[];

  const posts: WpPost[] = raw.map((p) => {
    const embedded = p._embedded ?? {};
    const media = embedded["wp:featuredmedia"]?.[0];
    const authorRaw = embedded.author?.[0];
    const flatTerms = (embedded["wp:term"] ?? []).flat();

    return {
      id: p.id,
      dateGmt: p.date_gmt,
      modifiedGmt: p.modified_gmt,
      slug: p.slug,
      link: p.link,
      status: p.status,
      title: p.title.rendered,
      contentHtml: p.content.rendered,
      excerptHtml: p.excerpt.rendered,
      featuredMedia: media && !media.code && media.source_url ? { url: media.source_url, alt: media.alt_text ?? "" } : null,
      author: authorRaw && !authorRaw.code ? { id: authorRaw.id, name: authorRaw.name, avatarUrl: authorRaw.avatar_urls?.["96"] } : null,
      categories: flatTerms.filter((t) => t.taxonomy === "category").map((t) => ({ id: t.id, name: t.name })),
      tags: flatTerms.filter((t) => t.taxonomy === "post_tag").map((t) => ({ id: t.id, name: t.name })),
    };
  });

  return { posts, totalPages: Math.max(totalPages, page), totalPosts };
}
