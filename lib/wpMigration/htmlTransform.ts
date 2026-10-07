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
  /** The Plexo dashboard's own origin — login forms send team members here. */
  appUrl: string;
}

export interface MigratedForm {
  id: string;
  name: string;
  plugin: string;
  fields: string[];
}

/** A WordPress payment/donation form converted to a native Plexo donation campaign. */
export interface DetectedDonationForm {
  /** Stable id of the source form, e.g. "wp-payment-form:3453" — the campaign's `source`. */
  source: string;
  /** Placeholder written into data-plexo-donation; the job swaps in the real campaign id. */
  token: string;
  name: string;
  presets: { label?: string; amountMinor: number }[];
  defaultPresetIndex: number;
  allowCustomAmount: boolean;
  minAmountMinor: number;
  allowMonthly: boolean;
  currency: string | null;
  buttonLabel: string | null;
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
  /** Login forms pointed at Plexo sign-in (a members/staff area that needs team access set up). */
  loginForms: number;
  /** Site-search forms that now search the web scoped to this site. */
  searchForms: number;
  /** Donation forms converted to Plexo Donations (the job creates their campaigns). */
  donationForms: DetectedDonationForm[];
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

function humanizeFieldName(name: string): string {
  const base = name.replace(/\[\]$/, "").replace(/^.*\[([^\]]+)\]$/, "$1").replace(/[-_]\d+$/, "").replace(/[-_]+/g, " ").trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Field";
}

function cleanLabel(text: string): string {
  return text.replace(/\*/g, "").replace(/\s+/g, " ").trim();
}

/** The visible question a field answers: its <label for>, a wrapping <label>, an adjacent label, or aria/placeholder text. */
function labelFor(form: cheerio.Cheerio<AnyNode>, field: cheerio.Cheerio<AnyNode>): string | null {
  const id = field.attr("id");
  let text = id ? form.find(`label[for="${id.replace(/"/g, '\\"')}"]`).first().text() : "";
  if (!text) {
    // A wrapping label holds the field itself; take only its own text, not a <select>'s options.
    const wrap = field.closest("label").clone();
    wrap.find("select, option, textarea").remove();
    text = wrap.text();
  }
  if (!text) text = field.prevAll("label").first().text();
  if (!text) text = field.parent().prevAll("label").first().text() || field.parent().children("label").first().text();
  if (!text) text = field.attr("aria-label") || field.attr("placeholder") || "";
  return cleanLabel(text) || null;
}

const PLUGIN_FORM_SELECTORS: { plugin: string; selector: string; scriptMarker: RegExp }[] = [
  { plugin: "forminator", selector: "form.forminator-custom-form", scriptMarker: /forminator/i },
  { plugin: "contact-form-7", selector: "form.wpcf7-form", scriptMarker: /wpcf7|contact-form-7/i },
  { plugin: "wpforms", selector: "form.wpforms-form", scriptMarker: /wpforms/i },
  { plugin: "elementor-pro", selector: "form.elementor-form", scriptMarker: /elementor-pro\/assets\/js\/form/i },
];

// Hidden plumbing fields every form plugin posts back to WordPress — meaningless to Plexo
// and noise in the owner's submission inbox. Any hidden field whose name ends in "nonce" is
// WordPress's CSRF token pattern, whatever plugin printed it.
const PLUGIN_HIDDEN_FIELD_RE = /^(_wpnonce|.*_nonce|nonce|_wp_http_referer|_wp_original_http_referer|referer_url|form_page|forminator_nonce|form_id|page_id|form_type|current_url|render_id|action|referer_title|redirect_to|_wpcf7.*|wpforms\[(id|author|post_id|token)\]|post_id|form_fields\[.*_hp.*\]|queried_id|referrer|g-recaptcha-response)$/i;

// Where a form posts back to WordPress itself — and so has nothing to post to once the
// site is on Plexo. Matched against the action's path after origin rewriting.
const WORDPRESS_ENDPOINT_RE = /\/wp-admin\/admin-(post|ajax)\.php$|\/wp-json\/|\/wp-comments-post\.php$|\/wp-login\.php$|[?&]rest_route=/i;

const CAPTCHA_SELECTOR = ".g-recaptcha, .elementor-g-recaptcha, .wpcf7-recaptcha, .wpforms-recaptcha-container, .forminator-g-recaptcha, .cf-turnstile, .h-captcha, .elementor-field-type-recaptcha, .elementor-field-type-recaptcha_v3";

const PAYMENT_FORM_SELECTOR = "form.wpf_form, form[data-wpf_form_id], form.give-form, form.woocommerce-cart-form, form.checkout.woocommerce-checkout";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "form";
}

/** A short owner-facing name for a form: the nearest heading above it on the page, else the page title. */
function formDisplayName($: cheerio.CheerioAPI, form: cheerio.Cheerio<AnyNode>, ctx: TransformContext, index: number): string {
  let heading = "";
  let node: cheerio.Cheerio<AnyNode> = form;
  for (let depth = 0; depth < 6 && !heading; depth++) {
    heading = node.prevAll("h1, h2, h3, h4").first().text() || node.prevAll().find("h1, h2, h3, h4").last().text();
    node = node.parent();
    if (node.length === 0) break;
  }
  heading = cleanLabel(heading);
  if (heading && heading.length <= 60) return heading;
  return `${ctx.pageTitle || "Website"} form${index > 1 ? ` ${index}` : ""}`;
}

function isSearchForm($: cheerio.CheerioAPI, form: cheerio.Cheerio<AnyNode>): boolean {
  return form.find('input[name="s"]').length > 0 && (form.attr("method") || "get").toLowerCase() === "get";
}

function isLoginForm(form: cheerio.Cheerio<AnyNode>): boolean {
  return form.find('input[type="password"]').length > 0;
}

function postsToWordPress(form: cheerio.Cheerio<AnyNode>): boolean {
  const action = (form.attr("action") || "").trim();
  if (WORDPRESS_ENDPOINT_RE.test(action.split("#")[0])) return true;
  // WordPress's own convention: a form with no (or a same-page) action and a hidden
  // "action" field is handled by admin-post/admin-ajax via the plugin's JavaScript.
  const sameOrEmpty = !action || action === "#" || action.startsWith("?");
  return sameOrEmpty && form.find('input[type="hidden"][name="action"]').length > 0 && (form.attr("method") || "get").toLowerCase() === "post";
}

/**
 * Points one form at Plexo Forms: same fields, labels and styling, posting to
 * /api/public/forms/<site>/submit, which stores the submission in the owner's dashboard
 * and emails them. Field names become their visible labels ("Full Name", not "full_name");
 * a checkbox/radio group is named for its question and keeps every ticked value.
 */
function rewireOneForm($: cheerio.CheerioAPI, form: cheerio.Cheerio<AnyNode>, ctx: TransformContext, plugin: string, index: number): MigratedForm {
  const formId = form.attr("id") || `plexo-form-${index}`;
  form.attr("id", formId);
  const name = formDisplayName($, form, ctx, index);
  const redirect = `${ctx.pagePath}?plexo_form=${encodeURIComponent(slugify(formId))}#${formId}`;
  form.attr("action", `/api/public/forms/${ctx.siteTemplateId}/submit?form=${encodeURIComponent(name)}&redirect=${encodeURIComponent(redirect)}`);
  form.attr("method", "post");
  form.removeAttr("enctype");
  form.removeAttr("novalidate");
  form.removeAttr("onsubmit");
  form.removeAttr("data-forminator-render");
  // A captcha checks submissions on WordPress's side, which Plexo doesn't do — kept, it'd be
  // a box that does nothing (or Google's "invalid domain for site key" on a new address).
  // Plexo Forms' honeypot (below) does the spam-blocking instead.
  form.find(CAPTCHA_SELECTOR).each((_, el) => {
    const widget = $(el);
    const group = widget.closest(".elementor-field-group, .wpforms-field, .forminator-row, p");
    (group.length > 0 && group.closest("form").is(form) && group.find("input:not([type=hidden]), select, textarea").length === 0 ? group : widget).remove();
  });
  form.removeClass("forminator_ajax");
  const style = (form.attr("style") || "").replace(/display\s*:\s*none\s*;?/gi, "").trim();
  if (style) form.attr("style", style);
  else form.removeAttr("style");

  // How many inputs share each name — a shared name means a choice group.
  const nameCounts = new Map<string, number>();
  form.find("input[name], select[name], textarea[name]").each((_, el) => {
    const n = $(el).attr("name") || "";
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  });

  const used = new Set<string>();
  const groupNames = new Map<string, string>();
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
    if (field.attr("aria-required") === "true" || field.attr("data-required") === "true" || field.attr("data-required") === "yes") field.attr("required", "required");

    const isChoice = type === "checkbox" || type === "radio";
    const isGroup = isChoice && ((nameCounts.get(originalName) ?? 0) > 1 || originalName.endsWith("[]"));
    let finalName: string;
    if (isChoice) {
      // A choice's own label is its option text ("Community Outreach"), not the question —
      // the group is named for the field, and the stored value is the option itself.
      if (!groupNames.has(originalName)) {
        let label = isGroup ? humanizeFieldName(originalName) : labelFor(form, field) ?? humanizeFieldName(originalName);
        for (let n = 2; used.has(label); n++) label = `${humanizeFieldName(originalName)} (${n})`;
        used.add(label);
        groupNames.set(originalName, label);
      }
      finalName = groupNames.get(originalName)!;
      const optionText = labelFor(form, field);
      const value = field.attr("value");
      if ((!value || value === "on" || value === "1") && optionText) field.attr("value", optionText);
    } else {
      const label = labelFor(form, field) ?? humanizeFieldName(originalName);
      finalName = label;
      for (let n = 2; used.has(finalName); n++) finalName = `${label} (${n})`;
      used.add(finalName);
    }
    field.attr("name", finalName);
    if (!fieldNames.includes(finalName)) fieldNames.push(finalName);
  });

  form.append(
    `<div style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden" aria-hidden="true"><input type="text" name="${HONEYPOT_FIELD_NAME}" tabindex="-1" autocomplete="off" value=""></div>`,
  );
  // No WordPress to show a success message any more — show one ourselves after the
  // endpoint's 303 lands the visitor back on this page.
  form.after(
    `<script>(function(){try{var p=new URLSearchParams(location.search);if(p.get("plexo_form")!==${JSON.stringify(slugify(formId))})return;var f=document.getElementById(${JSON.stringify(formId)});if(!f)return;var m=document.createElement("div");m.setAttribute("role","status");m.textContent="Thank you — your submission has been received. We'll be in touch soon.";function show(){var hidden=!f.offsetParent||f.getBoundingClientRect().height===0;if(hidden){m.style.cssText="position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483000;max-width:92vw;padding:14px 22px;border-radius:10px;background:#14532d;color:#fff;font:600 15px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.25)";document.body.appendChild(m);setTimeout(function(){m.remove()},8000);}else{m.style.cssText="margin:0 0 16px;padding:14px 18px;border-radius:8px;background:#e8f5ee;color:#14532d;font:inherit;font-weight:600";f.parentNode.insertBefore(m,f);}}document.readyState==="complete"?show():window.addEventListener("load",show);f.reset&&f.reset();}catch(e){}})();</script>`,
  );
  if (plugin === "forminator" && form.attr("data-design") === "material") {
    // Forminator's "material" style floats each label inside its field until the field is
    // focused or filled — driven by three state classes its (removed) script toggled. This
    // reproduces only that, so the form looks exactly as it did.
    form.after(
      `<script>(function(){var f=document.getElementById(${JSON.stringify(formId)});if(!f)return;f.querySelectorAll(".forminator-field").forEach(function(w){var l=w.querySelector(".forminator-label"),i=w.querySelector("input.forminator-input,textarea.forminator-textarea");if(!l||!i||i.type==="checkbox"||i.type==="radio")return;var t=i.tagName==="TEXTAREA";l.classList.add(t?"forminator-floating--textarea":"forminator-floating--input");if(!t&&!i.parentNode.classList.contains("forminator-input--wrap")){var d=document.createElement("div");d.className="forminator-input--wrap";i.parentNode.insertBefore(d,i);d.appendChild(i);}function s(){w.classList.toggle("forminator-is_filled",!!i.value);}i.addEventListener("focus",function(){w.classList.add("forminator-is_active");});i.addEventListener("blur",function(){w.classList.remove("forminator-is_active");s();});i.addEventListener("input",s);s();});})();</script>`,
    );
  }
  return { id: formId, name, plugin, fields: fieldNames };
}

export function donationToken(source: string): string {
  return `__PLEXO_DONATION__${source}__`;
}

/** Paymattic prints the store currency into its page config: "currency_settings":{"currency":"USD". */
function paymatticCurrency(html: string): string | null {
  const m = html.match(/"currency_settings"\s*:\s*\{\s*"currency"\s*:\s*"([A-Z]{3})"/);
  return m ? m[1] : null;
}

/**
 * Paymattic (WPPayForm) donation forms → Plexo Donations. Reads the form's own definition
 * (suggested amounts with their names, the pre-selected one, custom amount, the monthly
 * option, the donor fields) and annotates the SAME markup with the data-plexo-* hooks
 * public/commerce.js's donation adapter drives — so the form looks exactly as it did and
 * takes payments through Plexo. Paymattic's own scripts and page config (which also
 * exposes the plugin's API keys in page source) are removed.
 */
function convertPaymatticForms($: cheerio.CheerioAPI, rawHtml: string): DetectedDonationForm[] {
  const found: DetectedDonationForm[] = [];
  const currency = paymatticCurrency(rawHtml);
  $("form[data-wpf_form_id], form.wpf_form").each((_, el) => {
    const form = $(el);
    const formId = form.attr("data-wpf_form_id") || form.attr("id") || String(found.length + 1);
    const source = `wp-payment-form:${formId}`;
    const presets: { label?: string; amountMinor: number }[] = [];
    let defaultPresetIndex = 0;
    let allowCustomAmount = false;
    form.find('input[type="radio"]').each((__, r) => {
      const radio = $(r);
      if (radio.attr("value") === "custom") {
        allowCustomAmount = true;
        radio.attr("data-plexo-amount-custom", "1");
        return;
      }
      const price = Number(radio.attr("data-price"));
      if (!Number.isFinite(price) || price <= 0) return;
      const label = cleanLabel(form.find(`label[for="${radio.attr("id")}"]`).first().text() || radio.closest("label").text());
      if (radio.attr("checked") !== undefined) defaultPresetIndex = presets.length;
      presets.push({ amountMinor: Math.round(price), ...(label ? { label } : {}) });
      radio.attr("data-plexo-amount-minor", String(Math.round(price)));
    });
    const custom = form.find('input.wpf_donation_custom_amount, input[data-is_custom_price="yes"], input[name$="_custom"][type="number"]').first();
    if (custom.length) {
      allowCustomAmount = true;
      custom.attr("data-plexo-custom-amount", "1");
      // A single fixed-price or custom-only form has no radios — the custom field IS the amount.
    }
    const monthly = form.find('input[type="checkbox"][name*="recurring"]').first();
    if (monthly.length) monthly.attr("data-plexo-monthly", "1");
    // The block revealed when monthly is ticked ("Debit me: every month").
    form.find(".wpf_donation_recurring_infos").attr("data-plexo-monthly-options", "1");
    form.find('input[name$="[first_name]"]').attr("data-plexo-donor-first", "1");
    form.find('input[name$="[last_name]"]').attr("data-plexo-donor-last", "1");
    form.find('input[name="customer_name"], input[name$="[full_name]"]').attr("data-plexo-donor-name", "1");
    form.find('input[type="email"]').first().attr("data-plexo-donor-email", "1");
    const button = form.find('button[type="submit"], button.wpf_submit_button, input[type="submit"]').first();
    // Paymattic keeps a hidden "Please Wait…" loading label inside the button.
    const buttonText = button.clone();
    buttonText.find('[style*="none"], [class*="loading"], [class*="loader"], .wpf_loading_svg').remove();
    // Paymattic renders its submit button disabled and enables it from its own script —
    // which is gone now, so the button must be usable straight from the markup.
    form.find("button, input[type=submit]").removeAttr("disabled");
    const token = donationToken(source);
    form.attr("data-plexo-donation", token);
    form.attr("data-plexo-donation-adapter", "wp-payment-form");
    form.removeAttr("action");
    found.push({
      source,
      token,
      name: formDisplayNameForDonation($, form) || "Donation",
      presets,
      defaultPresetIndex,
      allowCustomAmount: allowCustomAmount || presets.length === 0,
      // A custom-amount field with min="0" would accept a 1-cent gift; 1.00 is the floor.
      minAmountMinor: Math.max(100, Math.round(Number(custom.attr("min") || 1) * 100)),
      allowMonthly: monthly.length > 0,
      currency,
      buttonLabel: cleanLabel((buttonText.text() || button.attr("value") || "").replace(/please wait…?\.*/i, "")) || null,
    });
  });
  if (found.length > 0) {
    $("script").each((_, el) => {
      const src = $(el).attr("src") || "";
      const code = src ? "" : $(el).text();
      if (/\/plugins\/wp-payment-form\//.test(src) || /wp_payform_general|wpf_form_vars|window\.wpf_|paymattic/i.test(code)) $(el).remove();
    });
  }
  return found;
}

function formDisplayNameForDonation($: cheerio.CheerioAPI, form: cheerio.Cheerio<AnyNode>): string {
  let node: cheerio.Cheerio<AnyNode> = form;
  for (let depth = 0; depth < 8; depth++) {
    const heading = cleanLabel(node.prevAll("h1, h2, h3, h4").first().text() || node.prevAll().find("h1, h2, h3, h4").last().text());
    if (heading && heading.length <= 80) return heading;
    node = node.parent();
    if (node.length === 0) break;
  }
  return "";
}

/**
 * Reconnects every form that used to post back to WordPress:
 *  - known form plugins (Forminator, CF7, WPForms, Elementor Pro) and ANY other form whose
 *    target is a WordPress endpoint (a custom plugin's admin-post/admin-ajax/REST form)
 *    → Plexo Forms;
 *  - login forms → Plexo sign-in (credentials are never forwarded anywhere);
 *  - search forms → a web search scoped to the site (WordPress's ?s= search index is gone).
 * Payment/donation forms are left to the donation adapter and reported if unhandled.
 */
function rewireForms($: cheerio.CheerioAPI, ctx: TransformContext): { forms: MigratedForm[]; unmigrated: { plugin: string; reason: string }[]; loginForms: number; searchForms: number } {
  const forms: MigratedForm[] = [];
  const pluginsSeen = new Set<string>();
  const handled = new Set<AnyNode>();
  let index = 0;
  let loginForms = 0;
  let searchForms = 0;

  $(PAYMENT_FORM_SELECTOR).each((_, el) => {
    handled.add(el);
  });

  for (const { plugin, selector } of PLUGIN_FORM_SELECTORS) {
    $(selector).each((_, el) => {
      if (handled.has(el)) return;
      handled.add(el);
      index += 1;
      pluginsSeen.add(plugin);
      forms.push(rewireOneForm($, $(el), ctx, plugin, index));
    });
  }

  const host = new URL(ctx.origin).host;
  $("form").each((_, el) => {
    if (handled.has(el)) return;
    const form = $(el);
    if (isSearchForm($, form)) {
      handled.add(el);
      searchForms += 1;
      form.attr("action", "https://duckduckgo.com/");
      form.attr("method", "get");
      form.find('input[name="s"]').attr("name", "q");
      form.find('input[type="hidden"]').remove();
      form.append(`<input type="hidden" name="sites" value="${host}">`);
      return;
    }
    if (isLoginForm(form) && (postsToWordPress(form) || /wp-login|log-?in|portal/i.test(form.attr("action") || "") || form.find('input[name="log"], input[name="pwd"]').length > 0)) {
      handled.add(el);
      loginForms += 1;
      // Never send typed credentials anywhere: strip every field's name so nothing is
      // submitted, and point the form at Plexo's sign-in, where the owner's invited team
      // members log in to their Plexo account instead.
      form.attr("action", `${ctx.appUrl}/auth/login`);
      form.attr("method", "get");
      form.find("input, select, textarea").each((__, f) => {
        const type = ($(f).attr("type") || "").toLowerCase();
        if (type === "hidden") $(f).remove();
        else $(f).removeAttr("name");
      });
      form.append(`<input type="hidden" name="redirectTo" value="/dashboard"><p style="margin:12px 0 0;font-size:0.85em;opacity:0.75">Team members sign in with their Plexo account.</p>`);
      return;
    }
    if (postsToWordPress(form)) {
      handled.add(el);
      index += 1;
      forms.push(rewireOneForm($, form, ctx, "custom", index));
    }
  });

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

  const unmigrated: { plugin: string; reason: string }[] = [];
  $(PAYMENT_FORM_SELECTOR).each((_, el) => {
    if ($(el).attr("data-plexo-donation")) return; // converted by the donation adapter
    unmigrated.push({ plugin: "payments", reason: "Payment/donation form — connect Plexo payments so it can take payments." });
  });
  return { forms, unmigrated, loginForms, searchForms };
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
  const donationForms = convertPaymatticForms($, rawHtml);
  const { forms, unmigrated, loginForms, searchForms } = rewireForms($, ctx);
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
    loginForms,
    searchForms,
    donationForms,
    facts: extractFacts($),
  };
}

