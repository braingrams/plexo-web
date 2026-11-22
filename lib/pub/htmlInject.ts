import type { CommerceTheme } from "@/lib/commerce/deriveCommerceTheme";
import { analyticsSnippet } from "@/lib/consent/snippet";
import { DEFAULT_CONSENT, type ConsentSettings } from "@/lib/consent/model";
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

/**
 * The Google Analytics tag for a site whose owner turned it on (lib/googleAnalytics), with the cookie notice for
 * visitors who need one (lib/consent). Only a well-formed measurement ID (G-XXXX) is ever written into the page, and a
 * page that already mentions that ID (a migrated site with its own tag, or the owner's header code) is left alone so
 * visits are not counted twice. Callers run this AFTER the owner's header/footer code is added, so that check sees it.
 */
export function injectGoogleAnalyticsTag(html: string, measurementId: string, consent?: { required: boolean; settings: ConsentSettings }): string {
  if (!/^G-[A-Z0-9]{4,20}$/.test(measurementId) || html.includes(measurementId)) return html;
  const tag = analyticsSnippet({ measurementId, required: consent?.required ?? false, settings: consent?.settings ?? DEFAULT_CONSENT });
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const idx = headMatch.index + headMatch[0].length;
    return html.slice(0, idx) + tag + html.slice(idx);
  }
  return tag + html;
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

/** The new Plexo brand on the badge: lime action on a near-black bar (same values as plexopages.com and the dashboard). */
const BAR = { bg: "#0b0b12", text: "#f4f5f0", action: "#b8f34a", onAction: "#0b0b12" };

/** The logo is served by Plexo itself, so on a customer's own domain it needs Plexo's full address. */
function logoUrl(ctaHref: string): string {
  let origin = "https://plexo.charisol.io";
  try {
    const u = new URL(ctaHref);
    if (u.protocol === "https:" && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname)) origin = u.origin;
  } catch {
    /* keep the default */
  }
  return `${origin}/api/brand/logo/wordmark-on-dark`;
}

/**
 * The "Hosted with Plexo" bar. The word Plexo shows straight away and is swapped for the logo once the logo has loaded,
 * so the bar never looks empty or jumps; if the logo can't load, the word simply stays.
 */
export function injectBrandingBar(html: string, ctaHref: string): string {
  const bar = `<div data-plexo-badge style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 16px;background:${BAR.bg};color:${BAR.text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;line-height:1;border-top:1px solid rgba(255,255,255,0.08);box-shadow:0 -4px 20px rgba(0,0,0,0.35);">
  <span style="display:inline-flex;align-items:center;gap:6px;">Hosted with <span style="display:inline-flex;align-items:center;min-height:18px;"><strong>Plexo</strong><img src="${logoUrl(ctaHref)}" alt="" height="18" style="display:none;height:18px;width:auto;" onload="this.style.display='block';this.previousElementSibling.style.display='none'"></span></span>
  <a href="${ctaHref}" target="_blank" rel="noopener" style="background:${BAR.action};color:${BAR.onAction};padding:6px 14px;border-radius:8px;font-weight:700;text-decoration:none;">Host yours now</a>
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

// Plexo Commerce's runtime — the marker divs product/booking/shop_grid/etc. compile to
// (see plexo-sdk's compiler.ts) carry no inline <script> of their own (sanitizeCompiledHtml.ts
// strips script tags from the compiled body itself, BUILDER or RAW_UPLOAD), so this is
// injected outside that sanitized body, the same way as injectBrandingBar below — a
// Commerce-disabled site never gets this tag at all, see the call site's CommerceSettings
// gate.
export function injectCommerceScript(html: string, storefrontPath: string, checkoutPath: string | null, theme: CommerceTheme | null, productBase: string | null = null): string {
  // ?v=<deploy sha> busts both CloudFront and any visitor's browser cache on every
  // deploy — see cdk/lib/compute-stack.ts's assetVersion comment for why the origin's
  // own shorter Cache-Control on commerce.js isn't enough by itself (a browser that
  // already cached the pre-fix immutable response never re-requests this exact URL).
  // The config script must load BEFORE commerce.js reads window.__PLEXO_COMMERCE__ at
  // parse time — storefrontPath lets the site owner rename the storefront's URL (default
  // /store) without a commerce.js code change. checkoutPath is the checkout page's own
  // REAL resolved path (see getCheckoutPath) — commerce.js used to assume it always lives
  // at "{storefrontPath}/checkout" (true for the auto-provisioned flow, where checkout is
  // a genuine child of the storefront page), which 404ed for a hand-built site whose
  // checkout page isn't nested under its shop page at all; null falls back to that same
  // old assumption client-side, for a site with no CommerceSettings row yet. `theme` is
  // null when there's neither a merchant override nor an auto-detected signal (see the
  // call site) — commerce.js falls back to its own hardcoded look in that case, unchanged
  // from before theming existed. JSON.stringify already escapes quotes; the "</" replace
  // is defense in depth against a slug somehow containing it.
  // productBase: where product pages live (CommerceSettings.productUrlBase, e.g. a migrated
  // WooCommerce store's "/product"); null = under the storefront page.
  const configTag = `<script>window.__PLEXO_COMMERCE__=${JSON.stringify({ storefrontPath, checkoutPath, theme, productBase }).replace(/<\//g, "<\\/")};</script>`;
  const scriptTag = `${configTag}<script src="/commerce.js?v=${process.env.ASSET_VERSION ?? "dev"}" defer></script>`;
  const maskedHtml = html.replace(
    /<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>/gi,
    (block) => " ".repeat(block.length),
  );
  let insertAt = -1;
  const bodyCloseRe = /<\/body\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = bodyCloseRe.exec(maskedHtml)) !== null) {
    insertAt = match.index;
  }
  if (insertAt !== -1) {
    return html.slice(0, insertAt) + scriptTag + html.slice(insertAt);
  }
  return html + scriptTag;
}

/**
 * The owner's saved header/footer code (lib/customCode), already validated at save time. Header code goes
 * just before </head> (or right after <head> when there's no closing tag), footer code just before </body>.
 * Never called on the shared Plexo address or below Starter (see lib/customCode/gate.ts).
 */
export const OWNER_HEAD_MARK = "<!--plexo:owner-head-->";
export const OWNER_FOOTER_MARK = "<!--plexo:owner-footer-->";

export function injectCustomCode(html: string, code: { head?: string | null; footer?: string | null }): string {
  let out = html;
  // Once only: a page that already carries the marker (served through two layers) is never given the code twice.
  if (code.head && !out.includes(OWNER_HEAD_MARK)) {
    const masked = out.replace(/<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>/gi, (b) => " ".repeat(b.length));
    const block = OWNER_HEAD_MARK + code.head;
    const close = /<\/head\s*>/i.exec(masked);
    if (close) {
      out = out.slice(0, close.index) + block + out.slice(close.index);
    } else {
      // No <head>: go after <head ...>, else after <html ...>, else after the doctype — never in front of it (that would break the page's mode).
      const open = /<head[^>]*>/i.exec(masked) ?? /<html[^>]*>/i.exec(masked) ?? /<!doctype[^>]*>/i.exec(masked);
      out = open ? out.slice(0, open.index + open[0].length) + block + out.slice(open.index + open[0].length) : block + out;
    }
  }
  if (code.footer && !out.includes(OWNER_FOOTER_MARK)) out = insertBeforeBodyEnd(out, OWNER_FOOTER_MARK + code.footer);
  return out;
}

/**
 * The page's own script (the "Custom JavaScript" box of the classic editor), put before </body>. It lives in the design, not in the
 * compiled page, because the page sanitiser removes every inline script. Used when a classic page is served and when one is turned into code.
 */
export function injectCustomJs(html: string, customJs: string | null | undefined): string {
  const script = (customJs ?? "").trim();
  if (!script) return html;
  const scriptTag = `<script>\n${script}\n</script>`;
  const maskedHtml = html.replace(
    /<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>/gi,
    (block) => " ".repeat(block.length),
  );
  let insertAt = -1;
  const bodyCloseRe = /<\/body\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = bodyCloseRe.exec(maskedHtml)) !== null) {
    insertAt = match.index;
  }
  if (insertAt !== -1) {
    return html.slice(0, insertAt) + scriptTag + html.slice(insertAt);
  }
  return html + scriptTag;
}

