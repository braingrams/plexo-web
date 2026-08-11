import StarterKit from "@tiptap/starter-kit";
import ImageExtension from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { generateJSON, generateHTML } from "@tiptap/html/server";
import { sanitizeBlogHtml } from "@/lib/blog/sanitize";

const EXTENSIONS = [StarterKit, ImageExtension, LinkExtension, TextAlign.configure({ types: ["heading", "paragraph"] })];

const SHORTCODE_REGEX = /\[[a-zA-Z][a-zA-Z0-9_-]*[^\]]*\]/g;

/** WordPress shortcodes ([gallery], [caption], [embed], ...) never render as real HTML — flags them instead of leaving raw bracket text in the post. */
export function detectShortcodes(html: string): string[] {
  const matches = html.match(SHORTCODE_REGEX);
  return matches ? Array.from(new Set(matches)) : [];
}

function stripWordPressCruft(html: string): string {
  return html
    // Gutenberg block boundary comments — invisible in WP's own rendering, meaningless here.
    .replace(/<!--\s*\/?wp:[^>]*-->/g, "")
    // Shortcodes won't render as HTML — drop the raw brackets rather than showing them
    // literally as post text; detectShortcodes() (called separately, before this) is what
    // surfaces them to the import job's "needs attention" report.
    .replace(SHORTCODE_REGEX, "");
}

/**
 * Converts any already-extracted post-body HTML into Tiptap/ProseMirror JSON, for storage as
 * BlogPost.contentJson. Runs server-side via @tiptap/html's happy-dom-backed generateJSON (no
 * browser involved) — see that package's own docs for why happy-dom is required. The result is
 * sanitized again by savePost.ts/sanitize.ts on write, same as any other content source.
 *
 * `stripWpCruft` is opt-in (only WordPress content has Gutenberg block comments/shortcodes to
 * strip) so site-import's Squarespace/Readability-sourced posts (see lib/siteImport/) can share
 * this same conversion without WordPress-specific preprocessing running on non-WP HTML.
 */
export function convertHtmlToTiptapJson(rawHtml: string, opts: { stripWpCruft?: boolean } = {}): unknown {
  const cleaned = sanitizeBlogHtml(opts.stripWpCruft ? stripWordPressCruft(rawHtml) : rawHtml);
  return generateJSON(cleaned || "<p></p>", EXTENSIONS);
}

/** Converts one WordPress post's rendered HTML (the REST API's `content.rendered` field) — thin wrapper over convertHtmlToTiptapJson with WP-specific cruft stripping. */
export function convertWordPressHtmlToTiptapJson(rawHtml: string): unknown {
  return convertHtmlToTiptapJson(rawHtml, { stripWpCruft: true });
}

/** Renders Tiptap JSON back to HTML — the same round-trip the hand-authored editor does via editor.getHTML(), so imported and hand-written posts store contentHtml identically. */
export function tiptapJsonToHtml(json: unknown): string {
  return generateHTML(json as Parameters<typeof generateHTML>[0], EXTENSIONS);
}
