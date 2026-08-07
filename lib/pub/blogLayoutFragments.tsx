import type { BlogPostCard, BlogPostDetail } from "@/lib/blog/queries";

// Plain HTML string builders, not JSX/renderToStaticMarkup — Next's App Router disallows
// importing react-dom/server inside a Server Component (it already owns rendering), so
// these can't reuse blogTheme.tsx's JSX components directly the way the plan originally
// called for. They mirror those components' markup/CSS classes by hand instead, so the
// visual result (and the shared BlogStyles CSS) still matches exactly.

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(date: Date | string | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function categoryChipsHtml(post: Pick<BlogPostCard, "categories">, basePath: string): string {
  if (post.categories.length === 0) return "";
  return post.categories
    .map(({ category }) => `<a class="plexo-chip" href="${basePath}/category/${escapeHtml(category.slug)}">${escapeHtml(category.name)}</a>`)
    .join("");
}

function postCardHtml(post: BlogPostCard, basePath: string): string {
  const image = post.featuredImageUrl
    ? `<a href="${basePath}/${post.slug}"><img class="plexo-post-card__image" src="${escapeHtml(post.featuredImageUrl)}" alt="${escapeHtml(post.featuredImageAlt ?? "")}" /></a>`
    : "";
  const excerpt = post.excerpt ? `<p class="plexo-post-card__excerpt">${escapeHtml(post.excerpt)}</p>` : "";
  const author = post.author
    ? `<a href="${basePath}/author/${escapeHtml(post.author.slug)}">${escapeHtml(post.author.name)}</a><span>·</span>`
    : "";
  const readingTime = post.readingTimeMinutes ? `<span>·</span><span>${post.readingTimeMinutes} min read</span>` : "";
  return `
    <article class="plexo-post-card">
      ${image}
      ${categoryChipsHtml(post, basePath)}
      <h2 class="plexo-post-card__title"><a href="${basePath}/${post.slug}">${escapeHtml(post.title)}</a></h2>
      ${excerpt}
      <div class="plexo-post-meta">${author}<span>${formatDate(post.publishedAt)}</span>${readingTime}</div>
    </article>`;
}

/**
 * Builds the marker -> HTML fragment map for a single post, for lib/pub/blogLayoutRender.ts
 * to splice into a custom layout's compiled HTML.
 */
export function buildPostFragments(post: BlogPostDetail, basePath: string, commentsHtml: string) {
  const authorHtml = post.author
    ? `<span>${post.author.avatarUrl ? `<img src="${escapeHtml(post.author.avatarUrl)}" alt="" style="width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-right:8px;" />` : ""}${escapeHtml(post.author.name)}</span>`
    : "";

  return {
    title: escapeHtml(post.title),
    // Already sanitized HTML (lib/blog/sanitize.ts) — used verbatim. Wrapped in
    // plexo-post__body so the h1-h6/p/blockquote/img/code typography defined by
    // BlogStyles (see lib/pub/blogTheme.tsx) applies here too — this fragment has no
    // styling of its own (it's raw author-written HTML, not a builder element with
    // per-element inline styles), so without this wrapper class its headings and
    // paragraphs render with zero visual differentiation on a custom layout.
    content: `<div class="plexo-post__body">${post.contentHtml}</div>`,
    featuredImage: post.featuredImageUrl
      ? `<img src="${escapeHtml(post.featuredImageUrl)}" alt="${escapeHtml(post.featuredImageAlt ?? "")}" style="max-width:100%;border-radius:10px;" />`
      : "",
    date: post.publishedAt ? escapeHtml(formatDate(post.publishedAt)) : "",
    author: authorHtml,
    categories: categoryChipsHtml(post, basePath),
    comments: commentsHtml,
  };
}

/** Same idea for the listing page's single "Post List" slot — the whole grid rendered once. */
export function buildPostListFragment(posts: BlogPostCard[], basePath: string): string {
  if (posts.length === 0) {
    return `<p style="color:#6b7280;">No posts published yet.</p>`;
  }
  return `<div class="plexo-blog__grid">${posts.map((post) => postCardHtml(post, basePath)).join("")}</div>`;
}
