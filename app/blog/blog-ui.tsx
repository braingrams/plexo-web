import Link from "next/link";
import type { BlogPostCard } from "@/lib/blog/queriesDynamo";

/** Renders a JSON-LD `@graph` the same way app/layout.tsx does for the marketing site. */
export function JsonLd({ items }: { items: unknown[] }) {
  const graph = { "@context": "https://schema.org", "@graph": items };
  return (
    // eslint-disable-next-line react/no-danger
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }} />
  );
}

export function formatDate(date: Date | string | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function CategoryChips({ post }: { post: BlogPostCard }) {
  if (post.categories.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {post.categories.map(({ category }) => (
        <Link
          key={category.slug}
          href={`/blog/category/${category.slug}`}
          className="inline-flex items-center rounded-full bg-[var(--surface)] border border-[var(--brand-glow)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--brand)] hover:opacity-80 transition-opacity"
        >
          {category.name}
        </Link>
      ))}
    </div>
  );
}

export function PostMeta({ post }: { post: BlogPostCard }) {
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs text-[var(--text-muted)]">
      {post.author ? (
        <>
          {post.author.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.author.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover bg-[var(--surface)]" />
          ) : null}
          <span className="font-semibold text-[var(--text-main)]">{post.author.name}</span>
          <span>&middot;</span>
        </>
      ) : null}
      {post.publishedAt ? <time dateTime={new Date(post.publishedAt).toISOString()}>{formatDate(post.publishedAt)}</time> : null}
      {post.readingTimeMinutes ? (
        <>
          <span>&middot;</span>
          <span>{post.readingTimeMinutes} min read</span>
        </>
      ) : null}
    </div>
  );
}

export function PostCard({ post }: { post: BlogPostCard }) {
  return (
    <article className="group flex flex-col rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] overflow-hidden hover:border-[var(--brand-glow)] transition-colors">
      {post.featuredImageUrl ? (
        <Link href={`/blog/${post.slug}`} className="block overflow-hidden">
          {/* Post images are arbitrary S3/remote URLs, not allowlisted in next.config's
              remotePatterns — plain <img> is deliberate (same as the pub blog theme). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.featuredImageUrl}
            alt={post.featuredImageAlt ?? ""}
            className="w-full aspect-[16/9] object-cover group-hover:scale-[1.02] transition-transform duration-300"
          />
        </Link>
      ) : null}
      <div className="flex flex-col gap-3 p-5">
        <CategoryChips post={post} />
        <h2 className="text-lg font-bold tracking-tight leading-snug">
          <Link href={`/blog/${post.slug}`} className="text-[var(--text-main)] group-hover:text-[var(--brand)] transition-colors">
            {post.title}
          </Link>
        </h2>
        {post.excerpt ? <p className="text-sm text-[var(--text-muted)] leading-relaxed line-clamp-3">{post.excerpt}</p> : null}
        <PostMeta post={post} />
      </div>
    </article>
  );
}

/**
 * Dark-theme article typography for the sanitized post HTML. The pub blog's BlogStyles is a
 * light editorial theme (white background, #17181c text) built for migrated tenant sites —
 * this is its plexo.io-dark counterpart, scoped to `.blog-prose` so it can't leak into the
 * rest of the marketing site. contentHtml is sanitized at write time (lib/blog/sanitize.ts).
 */
export function ProseStyles() {
  return (
    <style
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{
        __html: `
        .blog-prose { font-size: 1.075rem; line-height: 1.8; color: var(--text-main); }
        .blog-prose > *:first-child { margin-top: 0; }
        .blog-prose p { margin: 1.25em 0; color: var(--text-main); }
        .blog-prose a { color: var(--brand); text-decoration: underline; text-underline-offset: 2px; }
        .blog-prose a:hover { opacity: 0.8; }
        .blog-prose h1, .blog-prose h2, .blog-prose h3, .blog-prose h4, .blog-prose h5, .blog-prose h6 {
          font-weight: 800; letter-spacing: -0.02em; line-height: 1.25; color: var(--text-main);
          margin-top: 1.8em; margin-bottom: 0.5em;
        }
        .blog-prose h1 { font-size: 1.9em; }
        .blog-prose h2 { font-size: 1.55em; }
        .blog-prose h3 { font-size: 1.28em; }
        .blog-prose h4, .blog-prose h5, .blog-prose h6 { font-size: 1.08em; }
        .blog-prose ul, .blog-prose ol { margin: 1.25em 0; padding-left: 1.5em; }
        .blog-prose li { margin: 0.4em 0; }
        .blog-prose ul { list-style: disc; }
        .blog-prose ol { list-style: decimal; }
        .blog-prose img { max-width: 100%; height: auto; border-radius: 12px; margin: 1.5em 0; }
        .blog-prose blockquote {
          border-left: 3px solid var(--brand); margin: 1.5em 0; padding: 0.4em 0 0.4em 1.25em;
          color: var(--text-muted); font-style: italic;
        }
        .blog-prose pre {
          background: rgba(0,0,0,0.35); border: 1px solid var(--surface-border);
          padding: 16px; border-radius: 12px; overflow-x: auto; margin: 1.5em 0; font-size: 0.9em;
        }
        .blog-prose code {
          background: var(--surface); border: 1px solid var(--surface-border);
          padding: 2px 6px; border-radius: 5px; font-size: 0.88em;
        }
        .blog-prose pre code { background: none; border: none; padding: 0; }
        .blog-prose hr { border: none; border-top: 1px solid var(--surface-border); margin: 2.5em 0; }
        .blog-prose table { width: 100%; border-collapse: collapse; margin: 1.5em 0; font-size: 0.95em; display: block; overflow-x: auto; }
        .blog-prose th, .blog-prose td { border: 1px solid var(--surface-border); padding: 8px 12px; text-align: left; }
        .blog-prose th { background: var(--surface); font-weight: 700; }
        `,
      }}
    />
  );
}
