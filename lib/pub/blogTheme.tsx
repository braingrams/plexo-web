import Link from "next/link";
import type { BlogPostCard } from "@/lib/blog/queries";
import { GOOGLE_FONTS_LIST, buildGoogleFontHref } from "./googleFonts";

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const DEFAULT_ACCENT = "#6d28d9";

/**
 * accentColor comes from BlogSite (admin-editable) and gets interpolated straight into a
 * raw <style> tag below — never trust it as pre-sanitized just because it's already in
 * the DB. Anything that isn't a strict 3/6-digit hex falls back to the default purple,
 * closing off any CSS-injection surface via this field.
 */
function sanitizeHexColor(input?: string | null): string {
  return input && HEX_COLOR_REGEX.test(input) ? input : DEFAULT_ACCENT;
}

// The 4 original no-download system stacks, kept as-is for anyone who picked them before
// the full Google Fonts catalog was added below.
const SYSTEM_FONT_STACKS: Record<string, string> = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  modern: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  elegant: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
};

const SYSTEM_FONT_OPTIONS = [
  { value: "sans", label: "Sans-serif (default)" },
  { value: "serif", label: "Serif (classic editorial)" },
  { value: "modern", label: "Modern sans" },
  { value: "elegant", label: "Elegant serif" },
];

// Every selectable value in the Font dropdown — the 4 system stacks plus the full curated
// Google Fonts catalog (see googleFonts.ts). Still a closed, code-controlled set (never a
// raw user-supplied font-family string) even though it's now ~85 entries instead of 4 —
// see BlogSite.fontPreset's schema comment for why that invariant matters. A Google Font's
// `value` doubles as its own CSS font stack (it already includes a generic fallback, e.g.
// "'Roboto', sans-serif"), so no separate stacks table is needed for those.
export const FONT_PRESET_OPTIONS = [
  ...SYSTEM_FONT_OPTIONS,
  ...GOOGLE_FONTS_LIST.map((f) => ({ value: f.value, label: f.label })),
];

const VALID_FONT_PRESET_VALUES = new Set(FONT_PRESET_OPTIONS.map((o) => o.value));

function resolveFontStack(preset?: string | null): string {
  if (preset && SYSTEM_FONT_STACKS[preset]) return SYSTEM_FONT_STACKS[preset];
  if (preset && VALID_FONT_PRESET_VALUES.has(preset)) return preset;
  return SYSTEM_FONT_STACKS.sans;
}

export interface BlogAppearance {
  accentColor?: string | null;
  fontPreset?: string | null;
}

/**
 * Presentational layer shared by every public blog page (listing, archives, post
 * detail). Deliberately self-contained CSS (no dependency on the tenant's own
 * page-builder theme) — a clean, editorial, WordPress-reader-familiar look that works
 * for any site, with just enough BlogSite-driven theming (accent color, font, logo,
 * header image — see SiteHeader) to approximate a migrated site's old brand without
 * reimplementing an arbitrary WordPress theme (not portable: PHP templates + theme CSS
 * tied to WordPress's own rendering engine).
 */
export function BlogStyles({ appearance }: { appearance?: BlogAppearance } = {}) {
  const accent = sanitizeHexColor(appearance?.accentColor);
  const font = resolveFontStack(appearance?.fontPreset);
  // null for the 4 system stacks (no download needed) or an invalid/legacy value.
  const googleFontHref = buildGoogleFontHref(font);

  return (
    <>
      {googleFontHref && <link rel="stylesheet" href={googleFontHref} />}
      <style
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `
        .plexo-blog { --plexo-accent: ${accent}; --plexo-font: ${font}; font-family: var(--plexo-font); color: #17181c; background: #fff; min-height: 100vh; }
        .plexo-blog a { color: var(--plexo-accent); text-decoration: none; }
        .plexo-blog a:hover { text-decoration: underline; }
        .plexo-blog__header-image { width: 100%; max-height: 320px; object-fit: cover; display: block; }
        .plexo-blog__header { max-width: 860px; margin: 0 auto; padding: 48px 24px 16px; text-align: center; }
        .plexo-blog__logo { max-height: 56px; margin: 0 auto 16px; display: block; }
        .plexo-blog__title { font-size: 2.25rem; font-weight: 800; margin: 0 0 8px; letter-spacing: -0.02em; }
        .plexo-blog__title a { color: inherit; }
        .plexo-blog__description { color: #6b7280; font-size: 1.05rem; margin: 0; }
        .plexo-blog__main { max-width: 860px; margin: 0 auto; padding: 24px 24px 80px; }
        .plexo-blog__grid { display: grid; gap: 32px; }
        .plexo-post-card { display: grid; gap: 12px; padding-bottom: 28px; border-bottom: 1px solid #eee; }
        .plexo-post-card:last-child { border-bottom: none; }
        .plexo-post-card__image { width: 100%; aspect-ratio: 2/1; object-fit: cover; border-radius: 12px; background: #f3f4f6; }
        .plexo-post-card__title { font-size: 1.5rem; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
        .plexo-post-card__title a { color: #17181c; }
        .plexo-post-card__excerpt { color: #4b5563; line-height: 1.6; margin: 0; }
        .plexo-post-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.85rem; color: #6b7280; }
        .plexo-post-meta__avatar { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; background: #e5e7eb; }
        /* var(--plexo-categories-*, <fallback>) is what the blog_categories marker's own
           Typography panel writes (see plexo-sdk's BlogTextPropertiesAccordion) — a plain
           inline color/font-size/font-weight on that marker div would otherwise be
           overridden by this class's own declarations, since .plexo-chip is more specific
           than plain inheritance. Falls back to the original accent-based look everywhere
           else .plexo-chip appears (post cards, the default theme) where no such ancestor exists. */
        .plexo-chip { display: inline-block; font-size: var(--plexo-categories-font-size, 0.75rem); font-weight: var(--plexo-categories-font-weight, 600); color: var(--plexo-categories-color, var(--plexo-accent)); background: color-mix(in srgb, var(--plexo-categories-color, var(--plexo-accent)) 10%, white); border-radius: 999px; padding: 3px 10px; margin: 2px 4px 2px 0; }
        .plexo-chip:hover { background: color-mix(in srgb, var(--plexo-categories-color, var(--plexo-accent)) 18%, white); text-decoration: none; }
        .plexo-pagination { display: flex; justify-content: space-between; margin-top: 40px; gap: 12px; }
        .plexo-pagination a, .plexo-pagination span { padding: 8px 16px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 0.9rem; font-weight: 600; }
        .plexo-pagination span.disabled { color: #c1c5cc; }
        .plexo-post { max-width: 720px; margin: 0 auto; padding: 48px 24px 96px; }
        .plexo-post__cover { width: 100%; max-height: 420px; object-fit: cover; border-radius: 14px; margin-bottom: 32px; }
        .plexo-post__title { font-size: 2.5rem; font-weight: 800; line-height: 1.15; letter-spacing: -0.02em; margin: 0 0 16px; }
        /* No explicit color here (deliberately) — on a custom layout this is nested inside
           the blog_content marker div, which carries the color the user picked in the
           builder's Typography panel as a plain inline style; an explicit color here would
           be a more specific declaration than that inherited value and silently win over
           it, which is exactly the "not respecting the page's color" bug. Inheriting from
           the nearest ancestor with a color (the marker div on a custom layout, or
           .plexo-blog's own color below on the default theme) is what's wanted either way. */
        .plexo-post__body { font-size: 1.125rem; line-height: 1.75; }
        /* Tailwind's global preflight resets h1-h6 to font-weight/font-size: inherit — these
           need to be set explicitly or headings render visually identical to body text (em
           units so they still scale with a custom font-size set on the ancestor marker div). */
        .plexo-post__body h1, .plexo-post__body h2, .plexo-post__body h3,
        .plexo-post__body h4, .plexo-post__body h5, .plexo-post__body h6 {
          font-weight: 800; letter-spacing: -0.01em; line-height: 1.3; margin-top: 2em; margin-bottom: 0.5em;
        }
        .plexo-post__body h1 { font-size: 1.85em; }
        .plexo-post__body h2 { font-size: 1.5em; }
        .plexo-post__body h3 { font-size: 1.25em; }
        .plexo-post__body h4, .plexo-post__body h5, .plexo-post__body h6 { font-size: 1.05em; }
        .plexo-post__body p { margin: 1.1em 0; }
        .plexo-post__body img { max-width: 100%; border-radius: 10px; }
        .plexo-post__body blockquote { border-left: 3px solid var(--plexo-accent); margin: 1.5em 0; padding: 0.2em 0 0.2em 1.2em; color: #4b5563; font-style: italic; }
        .plexo-post__body pre { background: #17181c; color: #f0f2ff; padding: 16px; border-radius: 10px; overflow-x: auto; }
        .plexo-post__body code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
        .plexo-post__body pre code { background: none; padding: 0; }
        .plexo-empty { text-align: center; color: #6b7280; padding: 64px 24px; }
        .plexo-breadcrumbs { font-size: 0.85rem; color: #6b7280; margin-bottom: 16px; }
        .plexo-breadcrumbs a { color: #6b7280; }
        .plexo-breadcrumbs a:hover { color: var(--plexo-accent); }
        .plexo-breadcrumbs__sep { margin: 0 8px; color: #d1d5db; }
        .plexo-blog__footer { text-align: center; padding: 32px 24px; color: #9ca3af; font-size: 0.85rem; }
        .plexo-comments { max-width: 720px; margin: 0 auto; padding: 32px 24px 96px; }
        .plexo-comments__heading { font-size: 1.35rem; font-weight: 800; margin: 0 0 20px; }
        .plexo-comments__empty { color: var(--plexo-comment-meta, #6b7280); font-size: 0.9rem; }
        .plexo-comment { padding: 16px 0; border-top: 1px solid #eee; }
        .plexo-comment--reply { margin-left: 28px; border-top: 1px dashed #eee; }
        /* The var(--plexo-comment-*, fallback) pattern below (same one --plexo-accent
           already uses) is what the blog_comments block's own Typography panel writes to,
           via plain custom properties on its marker div — inherited from there into every
           nested selector here. Falls back to the original hardcoded colors when there's
           no custom layout (or the user hasn't touched these controls), so the default
           theme's look is unchanged. */
        .plexo-comment__meta { font-size: 0.82rem; color: var(--plexo-comment-meta, #6b7280); margin-bottom: 6px; }
        .plexo-comment__meta strong { color: var(--plexo-comment-text, #17181c); }
        .plexo-comment__body { font-size: 0.92rem; line-height: 1.6; color: var(--plexo-comment-text, #1f2430); }
        .plexo-comment__reply-btn { margin-top: 6px; background: none; border: none; padding: 0; color: var(--plexo-accent); font-size: 0.78rem; font-weight: 600; cursor: pointer; }
        .plexo-comment-form { margin-top: 28px; padding-top: 24px; border-top: 1px solid #eee; display: grid; gap: 10px; }
        .plexo-comment-form__hp { position: absolute; left: -9999px; }
        .plexo-comment-form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .plexo-comment-form input, .plexo-comment-form textarea {
          padding: 10px 12px; border-radius: 8px; font: inherit; font-size: 0.88rem;
          background: var(--plexo-comment-input-bg, #fff);
          border: 1px solid var(--plexo-comment-input-border, #e5e7eb);
          color: var(--plexo-comment-input-text, #1f2430);
        }
        /* Browser autofill (e.g. a saved name/email) paints its own background over the
           input, ignoring the site's CSS entirely, unless overridden like this. */
        .plexo-comment-form input:-webkit-autofill {
          -webkit-box-shadow: 0 0 0 1000px var(--plexo-comment-input-bg, #fff) inset;
          -webkit-text-fill-color: var(--plexo-comment-input-text, #1f2430);
        }
        .plexo-comment-form button[type="submit"] {
          justify-self: start; padding: 9px 20px; border-radius: 8px; border: none; font-weight: 700; font-size: 0.85rem; cursor: pointer;
          background: var(--plexo-comment-button-bg, var(--plexo-accent));
          color: var(--plexo-comment-button-text, #fff);
        }
        .plexo-comment-form__replying-to { font-size: 0.8rem; color: var(--plexo-comment-meta, #6b7280); margin: 0; }
        .plexo-comment-form__replying-to button { background: none; border: none; color: var(--plexo-accent); cursor: pointer; font-size: 0.8rem; }
        .plexo-comment-form__status { font-size: 0.8rem; color: var(--plexo-comment-meta, #6b7280); margin: 0; min-height: 1.2em; }
        `,
        }}
      />
    </>
  );
}

export function SiteHeader({
  title,
  description,
  basePath,
  logoUrl,
  headerImageUrl,
}: {
  title: string;
  description?: string | null;
  basePath: string;
  logoUrl?: string | null;
  headerImageUrl?: string | null;
}) {
  return (
    <>
      {headerImageUrl ? <img className="plexo-blog__header-image" src={headerImageUrl} alt="" /> : null}
      <header className="plexo-blog__header">
        {logoUrl ? <img className="plexo-blog__logo" src={logoUrl} alt={title} /> : null}
        <h1 className="plexo-blog__title">
          <Link href={basePath}>{title}</Link>
        </h1>
        {description ? <p className="plexo-blog__description">{description}</p> : null}
      </header>
    </>
  );
}

export function SiteFooter() {
  return <footer className="plexo-blog__footer">Powered by Plexo</footer>;
}

/** Visual counterpart to the BreadcrumbList JSON-LD in lib/blog/seo.ts — same trail, just rendered. */
export function Breadcrumbs({ trail }: { trail: { label: string; href?: string }[] }) {
  return (
    <nav className="plexo-breadcrumbs" aria-label="Breadcrumb">
      {trail.map((item, i) => (
        <span key={i}>
          {item.href ? <Link href={item.href}>{item.label}</Link> : <span>{item.label}</span>}
          {i < trail.length - 1 ? <span className="plexo-breadcrumbs__sep">/</span> : null}
        </span>
      ))}
    </nav>
  );
}

function formatDate(date: Date | string | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function PostMeta({ post, basePath }: { post: BlogPostCard; basePath: string }) {
  return (
    <div className="plexo-post-meta">
      {post.author ? (
        <>
          {post.author.avatarUrl ? <img className="plexo-post-meta__avatar" src={post.author.avatarUrl} alt="" /> : null}
          <Link href={`${basePath}/author/${post.author.slug}`}>{post.author.name}</Link>
          <span>·</span>
        </>
      ) : null}
      <span>{formatDate(post.publishedAt)}</span>
      {post.readingTimeMinutes ? (
        <>
          <span>·</span>
          <span>{post.readingTimeMinutes} min read</span>
        </>
      ) : null}
    </div>
  );
}

export function CategoryChips({ post, basePath }: { post: BlogPostCard; basePath: string }) {
  if (post.categories.length === 0) return null;
  return (
    <div>
      {post.categories.map(({ category }) => (
        <Link key={category.slug} className="plexo-chip" href={`${basePath}/category/${category.slug}`}>
          {category.name}
        </Link>
      ))}
    </div>
  );
}

export function PostCard({ post, basePath }: { post: BlogPostCard; basePath: string }) {
  return (
    <article className="plexo-post-card">
      {post.featuredImageUrl ? (
        <Link href={`${basePath}/${post.slug}`}>
          <img className="plexo-post-card__image" src={post.featuredImageUrl} alt={post.featuredImageAlt ?? ""} />
        </Link>
      ) : null}
      <CategoryChips post={post} basePath={basePath} />
      <h2 className="plexo-post-card__title">
        <Link href={`${basePath}/${post.slug}`}>{post.title}</Link>
      </h2>
      {post.excerpt ? <p className="plexo-post-card__excerpt">{post.excerpt}</p> : null}
      <PostMeta post={post} basePath={basePath} />
    </article>
  );
}

export function Pagination({
  page,
  totalPages,
  buildHref,
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="plexo-pagination">
      {page > 1 ? <Link href={buildHref(page - 1)}>&larr; Newer posts</Link> : <span className="disabled">&larr; Newer posts</span>}
      <span>
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? <Link href={buildHref(page + 1)}>Older posts &rarr;</Link> : <span className="disabled">Older posts &rarr;</span>}
    </nav>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="plexo-empty">{message}</p>;
}

/** Renders a JSON-LD `@graph` the same way app/layout.tsx does for the main marketing site. */
export function JsonLd({ items }: { items: unknown[] }) {
  const graph = { "@context": "https://schema.org", "@graph": items };
  return (
    // eslint-disable-next-line react/no-danger
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }} />
  );
}
