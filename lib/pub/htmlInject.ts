import { BRAND } from "@/lib/theme";
// Serve-time HTML injection shared by every kind of published site — builder pages,
// raw uploads (app/pub/[domain]/[[...slug]]/route.ts) and React projects
// (lib/projects/serve.ts) — so a platform-level tag behaves identically everywhere.

export function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// JSON.stringify alone doesn't escape "</" — a value containing the literal substring
// "</script>" would otherwise prematurely close the tag this gets embedded in.
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// White-label favicon override for a published page — only called for orgs entitled to
// (and who've set) custom branding. A same-origin builder-compiled page won't already have
// its own <link rel="icon">, so this never needs to replace one, only add one.
export function injectFavicon(html: string, logoUrl: string): string {
  const linkTag = `<link rel="icon" href="${logoUrl}">`;
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const idx = headMatch.index + headMatch[0].length;
    return html.slice(0, idx) + linkTag + html.slice(idx);
  }
  return html;
}

// Applies to arbitrary HTML, which could contain a literal "</body>" string inside a
// <script>/<style> block or string literal that isn't the real closing tag — naively
// splicing at the first textual match risks landing mid-script and corrupting it. Masking
// out every <script>/<style> block's own contents before searching (replacing them with
// same-length blanks, so every other offset lines up 1:1 with the real, untouched `html`)
// means a fake "</body>" inside one can never be mistaken for the real tag, while every
// byte OUTSIDE the insertion point still reaches the browser exactly as it was.
export function insertBeforeBodyEnd(html: string, fragment: string): string {
  const maskedHtml = html.replace(
    /<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>/gi,
    (block) => " ".repeat(block.length),
  );
  let insertAt = -1;
  const bodyCloseRe = /<\/body\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = bodyCloseRe.exec(maskedHtml)) !== null) {
    insertAt = match.index; // last real match wins — see comment above
  }
  if (insertAt !== -1) {
    return html.slice(0, insertAt) + fragment + html.slice(insertAt);
  }
  return html + fragment;
}

/** Marker the content widget (public/plexo-content.js) fills in — a plain div that works in every builder. */
export const CONTENT_MARKER_ATTR = "data-plexo-content";

/** Content widget runtime (videos, stories, events…). Same injection for builder pages, raw uploads and React projects. */
export function injectContentScript(html: string): string {
  return insertBeforeBodyEnd(html, `<script src="/plexo-content.js?v=${process.env.ASSET_VERSION ?? "dev"}" defer></script>`);
}

/**
 * Form connector (public/plexo-forms.js): sends any form on the page to this site's Form Submissions.
 * `auto: false` (React projects) connects only forms marked data-plexo-form — an app's own forms
 * already have their own handlers, so Plexo never takes one over unasked.
 */
export function injectFormsScript(html: string, templateId: string, opts: { auto: boolean }): string {
  return insertBeforeBodyEnd(
    html,
    `<script src="/plexo-forms.js?v=${process.env.ASSET_VERSION ?? "dev"}" data-template-id="${escapeHtmlAttr(templateId)}" data-auto="${opts.auto}" defer></script>`,
  );
}

export function injectBrandingBar(html: string, ctaHref: string): string {
  const bar = `<div style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 16px;background:#0b0f19;color:#f0f2ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;line-height:1;border-top:1px solid rgba(255,255,255,0.08);box-shadow:0 -4px 20px rgba(0,0,0,0.35);">
  <span>Hosted with <strong>Plexo</strong>.</span>
  <a href="${ctaHref}" target="_blank" rel="noopener" style="background:linear-gradient(135deg,${BRAND.primary},${BRAND.deep});color:#fff;padding:6px 14px;border-radius:8px;font-weight:700;text-decoration:none;">Host yours now</a>
</div>`;
  return insertBeforeBodyEnd(html, bar);
}

// Self-canonical + (optional) noindex + a baseline WebSite JSON-LD schema. A page that
// already declares its own canonical URL or structured data (a page migrated from
// WordPress carries Yoast's, an uploaded site may carry its own) is authoritative — adding
// ours on top would give search engines two conflicting canonicals, and pointing it at the
// Plexo preview host would hand the original site's rankings to the preview.
export function injectSeoTags(html: string, opts: { canonicalUrl: string; noindex: boolean; siteName: string }): string {
  const headEnd = html.search(/<\/head\s*>/i);
  const head = headEnd === -1 ? html.slice(0, 20000) : html.slice(0, headEnd);
  const hasOwnCanonical = /<link\b[^>]*\brel=["']?canonical["']?/i.test(head);
  const hasOwnSchema = /<script\b[^>]*application\/ld\+json/i.test(html);
  let tags = hasOwnCanonical ? "" : `<link rel="canonical" href="${escapeHtmlAttr(opts.canonicalUrl)}">`;
  if (opts.noindex) {
    tags += `<meta name="robots" content="noindex,nofollow">`;
  }
  if (!hasOwnSchema) {
    tags += `<script type="application/ld+json">${safeJsonLd({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: opts.siteName,
      url: opts.canonicalUrl,
    })}</script>`;
  }
  if (!tags) return html;
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const idx = headMatch.index + headMatch[0].length;
    return html.slice(0, idx) + tags + html.slice(idx);
  }
  return tags + html;
}
