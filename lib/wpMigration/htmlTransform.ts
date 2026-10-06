import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { assetPathFromRef, hostVariants, makeOriginRewriter } from "./urlSpace";

// Turns a page exactly as WordPress rendered it for a logged-out visitor into the page
// Plexo will serve: same markup, same CSS/JS, same SEO head — minus the parts that only
// make sense with a WordPress server behind them, and with forms reconnected to Plexo.
//
// What is deliberately NOT changed: the page's own SEO tags (canonical, Open Graph,
// Twitter cards, JSON-LD schema, hreflang). Those keep their absolute URLs on the owner's
// real domain — correct the moment the domain points at Plexo, and while it doesn't yet,
// they tell search engines the WordPress original is still canonical, so the Plexo preview
// can never be indexed as duplicate content.

/** Mirrors app/api/public/forms/[templateId]/submit/route.ts's HONEYPOT_FIELD_NAME. */
const HONEYPOT_FIELD_NAME = "_hp_field";

// Extensions the regex sweep treats as asset references. Matches what the migration can
// actually store (see assets.ts's MIGRATION_ASSET_EXTENSIONS) minus html, which is never
// an asset in a WordPress page.
const ASSET_EXT = "css|js|mjs|json|map|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|pdf|mp4|webm|ogv|mp3|wav|m4a|ogg|txt|xml|webmanifest";
const ASSET_EXT_RE = new RegExp(`\\.(?:${ASSET_EXT})$`, "i");

// Root-relative asset paths anywhere in the document — catches references inside inline
// JSON config (Elementor's data-settings, gallery/slider/video-playlist payloads, swiper
// slide lists) that no attribute selector can see. Runs after origin rewriting, so the
// site's own absolute URLs are already root-relative by then. The negative lookbehind
// excludes protocol-relative third-party URLs (//cdn.example.com/x.js) and paths glued
// onto another word.
const ROOT_RELATIVE_ASSET_RE = new RegExp(
  `(?<![\\w/\\\\:.])((?:\\\\?/)(?:[\\w.~%@+\\-]+\\\\?/)*[\\w.~%@+\\-]+\\.(?:${ASSET_EXT}))(?=[?#"'\\s),\\\\&;<]|$)`,
  "gi",
);

const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi;

export interface TransformContext {
  origin: string;
  /** The URL this HTML was fetched from — relative references resolve against it. */
  pageUrl: string;
  /** Root-relative path the page is served at on Plexo (for form redirects back to itself). */
  pagePath: string;
  pageTitle: string;
  /** Plexo site (root Template) id — the form endpoint is scoped to it. */
  siteTemplateId: string;
  /** Old page path → new path for links whose target moved (WordPress posts → /blog/<slug>). Keys are pageKey()-normalized. */
  movedLinks: Record<string, string>;
}

export interface MigratedForm {
  id: string;
  name: string;
  plugin: string;
  fields: string[];
}

export interface PageFacts {
  title: string;
  metaDescription: string | null;
  canonical: string | null;
  robots: string | null;
  h1Count: number;
  wordCount: number;
  jsonLdBlocks: number;
}

export interface TransformResult {
  html: string;
  /** Decoded path segments of every same-origin asset the page references. */
  assetPaths: string[][];
  /** Root-relative same-origin <a href> targets — fed to the link-integrity check. */
  internalLinks: string[];
  forms: MigratedForm[];
  /** Forms we found but could not reconnect (payment forms) — shown in the report. */
  unmigratedForms: { plugin: string; reason: string }[];
  facts: PageFacts;
}

const SEO_PROTECTED_RE =
  /<link\b[^>]*\brel=["']?(?:canonical|alternate)["']?[^>]*>|<meta\b[^>]*\b(?:property|name)=["']?(?:og:|twitter:|article:)[^>]*>|<script\b[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script\s*>/gi;

function protectSeo(html: string): { html: string; restore: (s: string) => string } {
  const saved: string[] = [];
  const out = html.replace(SEO_PROTECTED_RE, (m) => {
    // RSS/feed alternates are site-relative links, not SEO identity — let them be rewritten.
    if (/type=["']?application\/(?:rss|atom)\+xml/i.test(m)) return m;
    saved.push(m);
    return `\u0000PLEXOSEO${saved.length - 1}\u0000`;
  });
  return { html: out, restore: (s) => s.replace(/\u0000PLEXOSEO(\d+)\u0000/g, (_, i) => saved[Number(i)]) };
}

function isSameSiteUrl(url: URL, origin: string): boolean {
  return hostVariants(origin).includes(url.host);
}

/** Resolves any reference (absolute, root-relative, relative) to a root-relative same-site path, or null for third-party/data/anchor refs. */
function toSitePath(ref: string, ctx: TransformContext): string | null {
  const trimmed = ref.trim();
  if (!trimmed || /^(data|blob|mailto|tel|javascript|about):/i.test(trimmed) || trimmed.startsWith("#")) return null;
  try {
    const u = new URL(trimmed, ctx.pageUrl);
    if (!/^https?:$/.test(u.protocol) || !isSameSiteUrl(u, ctx.origin)) return null;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

function srcsetUrls(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function rewriteSrcset(value: string, fn: (u: string) => string): string {
  return value
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      const [url, ...descriptor] = trimmed.split(/\s+/);
      return [fn(url), ...descriptor].join(" ");
    })
    .join(", ");
}

function removeWordPressCruft($: cheerio.CheerioAPI): void {
  $(
    [
      'link[rel="EditURI"]',
      'link[rel="wlwmanifest"]',
      'link[rel="https://api.w.org/"]',
      'link[rel="alternate"][type="application/json"]',
      'link[rel="alternate"][type^="application/json+oembed"]',
      'link[rel="alternate"][type^="text/xml+oembed"]',
      'link[rel="shortlink"]',
      'link[rel="pingback"]',
      'link[rel="dns-prefetch"][href*="s.w.org"]',
      'meta[name="generator"]',
      "#wpadminbar",
      "link#admin-bar-css",
      "style#admin-bar-inline-css",
      "style#wp-emoji-styles-inline-css",
      'script[src*="wp-emoji-release"]',
      'script[src*="/wp-includes/js/comment-reply"]',
    ].join(", "),
  ).remove();

  $("script:not([src])").each((_, el) => {
    const code = $(el).text();
    if (/_wpemojiSettings|wp-emoji-loader|wpEmojiSettingsSupports/.test(code)) $(el).remove();
  });

  // Comment feeds have nothing behind them on Plexo; the posts feed moves to the Plexo blog's.
  $('link[rel="alternate"][type="application/rss+xml"], link[rel="alternate"][type="application/atom+xml"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    if (/comments/i.test(href)) $(el).remove();
    else $(el).attr("href", "/blog/feed.xml");
  });

  // WordPress (or Yoast + a theme) frequently prints the canonical tag twice — keep the first.
  $('link[rel="canonical"]').slice(1).remove();
}

/** Lazy-load plugins park the real image in data-src behind a placeholder src — promote it so the image doesn't depend on that plugin's JS. */
function promoteLazyImages($: cheerio.CheerioAPI): void {
  $("img[data-src], img[data-lazy-src], source[data-srcset], img[data-srcset]").each((_, el) => {
    const $el = $(el);
    const real = $el.attr("data-lazy-src") || $el.attr("data-src");
    const src = $el.attr("src") || "";
    if (real && (!src || src.startsWith("data:") || /lazy|placeholder|blank/i.test(src))) $el.attr("src", real);
    const realSet = $el.attr("data-lazy-srcset") || $el.attr("data-srcset");
    if (realSet && !$el.attr("srcset")) $el.attr("srcset", realSet);
  });
}

function labelFor(form: cheerio.Cheerio<AnyNode>, field: cheerio.Cheerio<AnyNode>): string | null {
  const id = field.attr("id");
  let text = id ? form.find(`label[for="${id.replace(/"/g, '\\"')}"]`).first().text() : "";
  if (!text) text = field.closest("label").text();
  if (!text) text = field.attr("aria-label") || field.attr("placeholder") || "";
  text = text.replace(/\*/g, "").replace(/\s+/g, " ").trim();
  return text || null;
}

const PLUGIN_FORM_SELECTORS: { plugin: string; selector: string; scriptMarker: RegExp }[] = [
  { plugin: "forminator", selector: "form.forminator-custom-form", scriptMarker: /forminator/i },
  { plugin: "contact-form-7", selector: "form.wpcf7-form", scriptMarker: /wpcf7|contact-form-7/i },
  { plugin: "wpforms", selector: "form.wpforms-form", scriptMarker: /wpforms/i },
  { plugin: "elementor-pro", selector: "form.elementor-form", scriptMarker: /elementor-pro\/assets\/js\/form/i },
];

// Hidden plumbing fields every form plugin posts back to WordPress — meaningless to Plexo
// and noise in the owner's submission inbox.
const PLUGIN_HIDDEN_FIELD_RE = /^(_wpnonce|_wp_http_referer|forminator_nonce|form_id|page_id|form_type|current_url|render_id|action|referer_title|_wpcf7.*|wpforms\[(id|author|post_id|token)\]|post_id|form_fields\[.*_hp.*\]|queried_id|referrer|g-recaptcha-response)$/i;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "form";
}

/**
 * Reconnects contact-style form plugins to Plexo's native form endpoint: the same
 * fields, labels and styling, posting to /api/public/forms/<site>/submit, which stores the
 * submission in the owner's dashboard and emails them. Field names become their visible
 * labels ("First Name" rather than Forminator's "name-1") so the submission inbox reads
 * naturally. The plugin's own front-end JS (which would intercept submit and AJAX it to
 * WordPress) is removed; its CSS stays so the form looks identical.
 */
function rewireForms($: cheerio.CheerioAPI, ctx: TransformContext): { forms: MigratedForm[]; unmigrated: { plugin: string; reason: string }[] } {
  const forms: MigratedForm[] = [];
  const pluginsSeen = new Set<string>();
  let index = 0;

  for (const { plugin, selector } of PLUGIN_FORM_SELECTORS) {
    $(selector).each((_, el) => {
      const form = $(el);
      index += 1;
      pluginsSeen.add(plugin);
      const formId = form.attr("id") || `plexo-form-${index}`;
      form.attr("id", formId);
      const name = `${ctx.pageTitle || "Website"} form${index > 1 ? ` ${index}` : ""}`;
      const redirect = `${ctx.pagePath}?plexo_form=${encodeURIComponent(slugify(formId))}#${formId}`;
      form.attr("action", `/api/public/forms/${ctx.siteTemplateId}/submit?form=${encodeURIComponent(name)}&redirect=${encodeURIComponent(redirect)}`);
      form.attr("method", "post");
      form.removeAttr("enctype");
      form.removeAttr("novalidate");
      form.removeAttr("data-forminator-render");
      form.removeClass("forminator_ajax");
      const style = (form.attr("style") || "").replace(/display\s*:\s*none\s*;?/gi, "").trim();
      if (style) form.attr("style", style);
      else form.removeAttr("style");

      const used = new Set<string>();
      const fieldNames: string[] = [];
      form.find("input, textarea, select").each((__, fieldEl) => {
        const field = $(fieldEl);
        const type = (field.attr("type") || "").toLowerCase();
        const originalName = field.attr("name") || "";
        if (type === "submit" || type === "button" || type === "image" || type === "reset") return;
        if (PLUGIN_HIDDEN_FIELD_RE.test(originalName) || (type === "hidden" && !originalName)) {
          field.remove();
          return;
        }
        if (type === "hidden") return; // a real hidden value the owner set up — keep as-is
        if (field.attr("aria-required") === "true" || field.attr("data-required") === "true") field.attr("required", "required");
        const label = labelFor(form, field) ?? (originalName.replace(/[-_]\d+$/, "").replace(/[-_]+/g, " ") || "Field");
        let unique = label;
        for (let n = 2; used.has(unique); n++) unique = `${label} (${n})`;
        if (type !== "radio" && type !== "checkbox") used.add(unique);
        field.attr("name", unique);
        if (!fieldNames.includes(unique)) fieldNames.push(unique);
      });

      form.append(
        `<div style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden" aria-hidden="true"><input type="text" name="${HONEYPOT_FIELD_NAME}" tabindex="-1" autocomplete="off" value=""></div>`,
      );
      // No WordPress to show a success message any more — show one ourselves after the
      // endpoint's 303 lands the visitor back on this page.
      form.after(
        `<script>(function(){try{var p=new URLSearchParams(location.search);if(p.get("plexo_form")!==${JSON.stringify(slugify(formId))})return;var f=document.getElementById(${JSON.stringify(formId)});if(!f)return;var m=document.createElement("div");m.setAttribute("role","status");m.style.cssText="margin:0 0 16px;padding:14px 18px;border-radius:8px;background:#e8f5ee;color:#14532d;font:inherit;font-weight:600";m.textContent="Thank you — your message has been sent. We'll be in touch soon.";f.parentNode.insertBefore(m,f);f.reset&&f.reset();}catch(e){}})();</script>`,
      );
      forms.push({ id: formId, name, plugin, fields: fieldNames });
    });
  }

  if (pluginsSeen.size > 0) {
    const markers = PLUGIN_FORM_SELECTORS.filter((p) => pluginsSeen.has(p.plugin)).map((p) => p.scriptMarker);
    $("script").each((_, el) => {
      const src = $(el).attr("src") || "";
      const code = src ? "" : $(el).text();
      if (markers.some((re) => re.test(src) || (code && re.test(code) && /\b(forminatorFront|wpcf7|wpforms|ElementorProFrontendConfig)\b/.test(code)))) {
        $(el).remove();
      }
    });
  }

  // Payment/donation forms can't be pointed at a contact-form inbox — they need a payment
  // processor. They're left exactly as they look and reported, never silently "fixed".
  const unmigrated: { plugin: string; reason: string }[] = [];
  if ($(".wpf_form, form.wpf_form, [data-wpf_form_id], .wppayform_form, .give-form, form.woocommerce-cart-form").length > 0) {
    unmigrated.push({ plugin: "wp-payment-form", reason: "Payment/donation form — needs Plexo payments connected before it can take payments." });
  }
  return { forms, unmigrated };
}

function collectAssetRefs($: cheerio.CheerioAPI, ctx: TransformContext): { assetRefs: Set<string>; links: Set<string> } {
  const assetRefs = new Set<string>();
  const links = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw) return;
    const p = toSitePath(raw, ctx);
    if (p) assetRefs.add(p);
  };

  const ASSET_RELS = /(^|\s)(stylesheet|icon|shortcut|apple-touch-icon|apple-touch-icon-precomposed|mask-icon|manifest|preload|prefetch|modulepreload)(\s|$)/i;
  $("link[href]").each((_, el) => {
    if (ASSET_RELS.test($(el).attr("rel") || "")) add($(el).attr("href"));
  });
  $("script[src], img[src], source[src], video[src], audio[src], track[src], embed[src], iframe[src], input[src]").each((_, el) => {
    const src = $(el).attr("src");
    if ((el as Element).tagName === "iframe") {
      // A same-site iframe is a page, not an asset; only a file-like iframe src is an asset.
      if (src && ASSET_EXT_RE.test((src.split(/[?#]/)[0]) || "")) add(src);
      return;
    }
    add(src);
  });
  $("video[poster]").each((_, el) => add($(el).attr("poster")));
  $("object[data]").each((_, el) => add($(el).attr("data")));
  $("image[href], image[xlink\\:href], use[href], use[xlink\\:href]").each((_, el) => {
    const ref = $(el).attr("href") || $(el).attr("xlink:href");
    if (ref && !ref.startsWith("#")) add(ref.split("#")[0]);
  });
  $("[srcset], [data-srcset]").each((_, el) => {
    for (const u of srcsetUrls($(el).attr("srcset") || $(el).attr("data-srcset") || "")) add(u);
  });
  $("[data-src], [data-lazy-src], [data-bg], [data-background], [data-bg-image], [data-thumbnail]").each((_, el) => {
    for (const attr of ["data-src", "data-lazy-src", "data-bg", "data-background", "data-bg-image", "data-thumbnail"]) add($(el).attr(attr));
  });
  $('meta[property="og:image"], meta[name="twitter:image"], meta[property="og:image:secure_url"], meta[name="msapplication-TileImage"]').each((_, el) =>
    add($(el).attr("content")),
  );
  $("[style]").each((_, el) => {
    for (const m of ($(el).attr("style") || "").matchAll(CSS_URL_RE)) add(m[2]);
  });
  $("style").each((_, el) => {
    for (const m of $(el).text().matchAll(CSS_URL_RE)) add(m[2]);
    for (const m of $(el).text().matchAll(/@import\s+(['"])([^'"]+)\1/gi)) add(m[2]);
  });
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const p = toSitePath(href, ctx);
    if (!p) return;
    const pathOnly = p.split(/[?#]/)[0];
    // Lightbox/gallery links and downloadable files point straight at media files.
    if (ASSET_EXT_RE.test(pathOnly)) assetRefs.add(p);
    else links.add(p);
  });
  return { assetRefs, links };
}

/**
 * Relative references only resolve correctly against the page's ORIGINAL URL. On Plexo a
 * page may be served with a trailing slash (or under an injected <base href>), which would
 * silently move every relative reference — so every same-site reference becomes
 * root-relative here, the one form that resolves identically everywhere.
 */
function makeRefsRootRelative($: cheerio.CheerioAPI, ctx: TransformContext): void {
  const fix = (raw: string): string => {
    if (!raw || raw.startsWith("/") || raw.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
    const p = toSitePath(raw, ctx);
    return p ?? raw;
  };
  const fixCss = (css: string): string =>
    css.replace(CSS_URL_RE, (m, q: string, u: string) => {
      const fixed = fix(u);
      return fixed === u ? m : `url(${q}${fixed}${q})`;
    });

  for (const attr of ["href", "src", "poster", "data", "data-src", "data-lazy-src", "data-bg", "data-background", "action"]) {
    $(`[${attr}]`).each((_, el) => {
      const $el = $(el);
      if (attr === "href" && (el as Element).tagName === "base") return;
      const v = $el.attr(attr);
      if (v !== undefined) {
        const fixed = fix(v);
        if (fixed !== v) $el.attr(attr, fixed);
      }
    });
  }
  $("[srcset], [data-srcset]").each((_, el) => {
    for (const attr of ["srcset", "data-srcset"]) {
      const v = $(el).attr(attr);
      if (v) $(el).attr(attr, rewriteSrcset(v, fix));
    }
  });
  $("[style]").each((_, el) => {
    const v = $(el).attr("style") || "";
    const fixed = fixCss(v);
    if (fixed !== v) $(el).attr("style", fixed);
  });
  $("style").each((_, el) => {
    const v = $(el).text();
    const fixed = fixCss(v);
    if (fixed !== v) $(el).text(fixed);
  });
}

function normalizeLinkKey(path: string): string {
  const pathname = path.split(/[?#]/)[0];
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // keep as-is
  }
  return decoded.length > 1 ? decoded.replace(/\/+$/, "") : decoded;
}

function rewriteMovedLinks($: cheerio.CheerioAPI, ctx: TransformContext): void {
  if (Object.keys(ctx.movedLinks).length === 0) return;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href.startsWith("/") || href.startsWith("//")) return;
    const target = ctx.movedLinks[normalizeLinkKey(href)];
    if (target) {
      const hash = href.includes("#") ? href.slice(href.indexOf("#")) : "";
      $(el).attr("href", `${target}${hash}`);
    }
  });
}

function extractFacts($: cheerio.CheerioAPI): PageFacts {
  const body = $("body").clone();
  body.find("script, style, noscript, template, svg").remove();
  const text = body.text().replace(/\s+/g, " ").trim();
  return {
    title: $("head > title").first().text().trim(),
    metaDescription: $('meta[name="description"]').attr("content")?.trim() ?? null,
    canonical: $('link[rel="canonical"]').attr("href") ?? null,
    robots: $('meta[name="robots"]').attr("content") ?? null,
    h1Count: $("h1").length,
    wordCount: text ? text.split(" ").length : 0,
    jsonLdBlocks: $('script[type="application/ld+json"]').length,
  };
}

/** Facts about the ORIGINAL page, before any transformation — the verification baseline. */
export function extractSourceFacts(html: string): PageFacts {
  return extractFacts(cheerio.load(html));
}

export function transformPage(rawHtml: string, ctx: TransformContext): TransformResult {
  // 1. Absolute → root-relative for every same-site URL outside the protected SEO tags.
  const rewriteOrigin = makeOriginRewriter(ctx.origin);
  const { html: masked, restore } = protectSeo(rawHtml);
  const rewritten = restore(rewriteOrigin(masked));

  // 2. Structural edits.
  const $ = cheerio.load(rewritten);
  removeWordPressCruft($);
  promoteLazyImages($);
  makeRefsRootRelative($, ctx);
  const { forms, unmigrated } = rewireForms($, ctx);
  rewriteMovedLinks($, ctx);

  // 3. Inventory what the finished page references.
  const { assetRefs, links } = collectAssetRefs($, ctx);
  const html = $.html();
  for (const m of html.matchAll(ROOT_RELATIVE_ASSET_RE)) assetRefs.add(m[1].replace(/\\\//g, "/"));

  const assetPaths: string[][] = [];
  const seen = new Set<string>();
  for (const ref of assetRefs) {
    const segments = assetPathFromRef(ref);
    if (!segments) continue;
    const key = segments.join("/");
    // Paths Plexo itself serves (the blog feed this transform links to, sitemap, forms API) aren't files to copy.
    if (/^(blog|api)\//.test(key) || key === "sitemap.xml" || key === "robots.txt") continue;
    if (seen.has(key)) continue;
    seen.add(key);
    assetPaths.push(segments);
  }

  return {
    html,
    assetPaths,
    internalLinks: Array.from(links),
    forms,
    unmigratedForms: unmigrated,
    facts: extractFacts($),
  };
}

