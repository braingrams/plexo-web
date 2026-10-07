import type { DetectedPlugin, PluginOutcome } from "./types";

// What happens to each WordPress plugin when its site moves to Plexo, written for the site
// owner (these strings are shown verbatim in the migration report). The catalog only needs
// to be right about the plugins that matter — anything unlisted falls back to an honest
// generic classification in classifyUnknownPlugin() below rather than being silently dropped.

interface CatalogEntry {
  name: string;
  outcome: PluginOutcome;
  explanation: string;
}

const CATALOG: Record<string, CatalogEntry> = {
  // ── Page builders & theme layers: their output is plain HTML/CSS/JS, carried over as-is.
  elementor: {
    name: "Elementor",
    outcome: "PRESERVED",
    explanation: "Your Elementor designs were copied exactly — layouts, fonts, animations and responsive breakpoints all look the same.",
  },
  "elementor-pro": {
    name: "Elementor Pro",
    outcome: "PRESERVED",
    explanation: "Elementor Pro's design features were copied exactly. Elementor Pro forms are reconnected to Plexo Forms.",
  },
  "header-footer-elementor": {
    name: "Ultimate Addons / Header Footer Elementor",
    outcome: "PRESERVED",
    explanation: "Your custom header, footer and breadcrumbs were copied onto every page.",
  },
  "sticky-header-effects-for-elementor": {
    name: "Sticky Header Effects",
    outcome: "PRESERVED",
    explanation: "Your sticky header behaves the same as before.",
  },
  "padamz-premium-widget": {
    name: "Padamz Premium Widgets",
    outcome: "PRESERVED",
    explanation: "Sliders, carousels and image cards from this widget pack were copied and keep working.",
  },
  "prolink-motion-fx-v3": {
    name: "Motion FX",
    outcome: "PRESERVED",
    explanation: "Scroll and motion animations were copied and keep working.",
  },
  "turbo-addons-elementor": {
    name: "Turbo Addons",
    outcome: "PRESERVED",
    explanation: "Widgets from this pack were copied and keep working.",
  },
  "essential-addons-for-elementor-lite": {
    name: "Essential Addons for Elementor",
    outcome: "PRESERVED",
    explanation: "Widgets from this pack were copied and keep working.",
  },
  "cookieadmin": {
    name: "CookieAdmin",
    outcome: "PRESERVED",
    explanation: "Your cookie consent banner was copied and still asks visitors for consent.",
  },
  "cookieadmin-pro": {
    name: "CookieAdmin Pro",
    outcome: "PRESERVED",
    explanation: "Your cookie consent banner was copied and still asks visitors for consent.",
  },
  "prolink-maildrip-newsletter": {
    name: "Maildrip Newsletter",
    outcome: "PRESERVED",
    explanation: "Newsletter sign-up boxes were copied and still send subscribers straight to your Maildrip list.",
  },

  // ── Replaced by a native Plexo feature.
  "wordpress-seo": {
    name: "Yoast SEO",
    outcome: "NATIVE",
    explanation:
      "Every page keeps its exact SEO title, meta description, social-share image and structured data. Plexo now generates your sitemap.xml and robots.txt, and every old URL keeps working.",
  },
  "seo-by-rank-math": {
    name: "Rank Math SEO",
    outcome: "NATIVE",
    explanation: "Every page keeps its SEO title, description and structured data; Plexo now generates your sitemap.xml and robots.txt.",
  },
  "all-in-one-seo-pack": {
    name: "All in One SEO",
    outcome: "NATIVE",
    explanation: "Every page keeps its SEO title, description and structured data; Plexo now generates your sitemap.xml and robots.txt.",
  },
  forminator: {
    name: "Forminator",
    outcome: "NATIVE",
    explanation:
      "Your forms were reconnected to Plexo Forms — submissions now arrive in your Plexo dashboard (Form Submissions) and by email, with spam protection built in.",
  },
  "contact-form-7": {
    name: "Contact Form 7",
    outcome: "NATIVE",
    explanation: "Your forms were reconnected to Plexo Forms — submissions arrive in your Plexo dashboard and by email.",
  },
  wpforms: {
    name: "WPForms",
    outcome: "NATIVE",
    explanation: "Your forms were reconnected to Plexo Forms — submissions arrive in your Plexo dashboard and by email.",
  },
  "wpforms-lite": {
    name: "WPForms Lite",
    outcome: "NATIVE",
    explanation: "Your forms were reconnected to Plexo Forms — submissions arrive in your Plexo dashboard and by email.",
  },
  "litespeed-cache": {
    name: "LiteSpeed Cache",
    outcome: "NATIVE",
    explanation: "Not needed any more — Plexo serves your site from a global CDN with caching built in.",
  },
  "wp-rocket": {
    name: "WP Rocket",
    outcome: "NATIVE",
    explanation: "Not needed any more — Plexo serves your site from a global CDN with caching built in.",
  },
  "w3-total-cache": {
    name: "W3 Total Cache",
    outcome: "NATIVE",
    explanation: "Not needed any more — Plexo serves your site from a global CDN with caching built in.",
  },
  "image-optimizer": {
    name: "Image Optimizer",
    outcome: "NATIVE",
    explanation: "Not needed any more — Plexo optimizes and lazy-loads images automatically.",
  },
  "wp-mail-smtp": {
    name: "WP Mail SMTP",
    outcome: "NATIVE",
    explanation: "Not needed any more — Plexo sends form notifications and other site emails for you.",
  },

  // ── Server-side features Plexo has to rebuild before they work again.
  "wp-payment-form": {
    name: "Paymattic (WPPayForm)",
    outcome: "NATIVE",
    explanation:
      "Your donation forms now run on Plexo Donations — same look, same amounts, custom amounts and monthly giving included, with receipts and a dashboard. Connect Stripe or Paystack (ideally the same account WordPress used, so existing monthly donors carry straight over) before switching your domain.",
  },

  woocommerce: {
    name: "WooCommerce",
    outcome: "NATIVE",
    explanation:
      "Your shop moved to Plexo Commerce: products (with their options, sale prices, SKUs and photos), categories and reviews, at the same web addresses. The shop, cart, checkout and account pages keep their design with Plexo's checkout inside. Connect Stripe or Paystack to start taking orders.",
  },
  "give": {
    name: "GiveWP",
    outcome: "NEEDS_ATTENTION",
    explanation: "Your donation forms were copied, but payments are processed by WordPress. Connect payments in Plexo before switching your domain.",
  },

  // ── WordPress infrastructure / admin tooling — nothing a visitor ever sees.
  "elementor-ai": { name: "Elementor AI", outcome: "NOT_NEEDED", explanation: "Editor-only tool — nothing to move." },
  "elementor-mcp-composer": { name: "Elementor MCP Composer", outcome: "NOT_NEEDED", explanation: "Editor-only tool — nothing to move." },
  "elementor-one": { name: "Elementor One", outcome: "NOT_NEEDED", explanation: "Account-connection tool — nothing to move." },
  "wpmudev-hub-connector": { name: "WPMU DEV Hub", outcome: "NOT_NEEDED", explanation: "WordPress hosting dashboard connector — nothing to move." },
  "wpmudev-pcs": { name: "WPMU DEV", outcome: "NOT_NEEDED", explanation: "WordPress hosting tool — nothing to move." },
  "nps-survey": { name: "NPS Survey", outcome: "NOT_NEEDED", explanation: "Plugin-feedback popup shown only to WordPress admins — nothing to move." },
  "mcp-adapter": { name: "WordPress MCP Adapter", outcome: "NOT_NEEDED", explanation: "WordPress AI-tooling bridge — Plexo has its own MCP connector." },
  jetpack: {
    name: "Jetpack",
    outcome: "NOT_NEEDED",
    explanation: "WordPress.com connection tools aren't needed — Plexo includes analytics, CDN and security. Any Jetpack widgets on your pages were copied.",
  },
  akismet: { name: "Akismet", outcome: "NOT_NEEDED", explanation: "Plexo Forms and comments have spam protection built in." },
  wordfence: { name: "Wordfence", outcome: "NOT_NEEDED", explanation: "WordPress-specific security — Plexo hosting isn't exposed to WordPress attacks." },
  "classic-editor": { name: "Classic Editor", outcome: "NOT_NEEDED", explanation: "Editor-only setting — nothing to move." },
};

// REST namespaces are the most reliable public signal of an active plugin, but they don't
// always match the plugin's folder slug. Core namespaces map to null (not a plugin).
const NAMESPACE_TO_SLUG: Record<string, string | null> = {
  "wp/v2": null,
  "oembed/1.0": null,
  "wp-site-health/v1": null,
  "wp-block-editor/v1": null,
  "wp-abilities/v1": null,
  "elementor/v1": "elementor",
  "elementor/v1/documents": "elementor",
  "elementor/v1/feedback": "elementor",
  "elementor-ai/v1": "elementor-ai",
  "elementor-one/v1": "elementor-one",
  "elementor-pro/v1": "elementor-pro",
  "hfe/v1": "header-footer-elementor",
  "forminator/v1": "forminator",
  "wppayform/v2": "wp-payment-form",
  "yoast/v1": "wordpress-seo",
  "rankmath/v1": "seo-by-rank-math",
  "aioseo/v1": "all-in-one-seo-pack",
  "litespeed/v1": "litespeed-cache",
  "litespeed/v3": "litespeed-cache",
  "image-optimizer/v1": "image-optimizer",
  "wp-mail-smtp/setup-wizard/v1": "wp-mail-smtp",
  "hub-connector/v1": "wpmudev-hub-connector",
  "wpmudev_pcs/v1": "wpmudev-pcs",
  "nps-survey/v1": "nps-survey",
  mcp: "mcp-adapter",
  "contact-form-7/v1": "contact-form-7",
  "wc/v3": "woocommerce",
  "wc/store/v1": "woocommerce",
  "jetpack/v4": "jetpack",
  "akismet/v1": "akismet",
  "wordfence/v1": "wordfence",
  "give-api/v2": "give",
};

/** True when Plexo knows exactly what this plugin is (and so how it's handled) — false for custom/unknown plugins. */
export function isCatalogedPlugin(slug: string): boolean {
  return slug in CATALOG;
}

/** Namespaces that are a versioned sub-route of another (elementor/v1/documents) or core — collapsed to the plugin they belong to. */
export function pluginSlugForNamespace(namespace: string): string | null {
  if (namespace in NAMESPACE_TO_SLUG) return NAMESPACE_TO_SLUG[namespace];
  if (namespace.startsWith("wp/") || namespace.startsWith("wp-")) return null;
  if (namespace.startsWith("elementor-mcp-composer")) return "elementor-mcp-composer";
  // Unknown namespace: its first segment is almost always the plugin's own prefix.
  return namespace.split("/")[0] || null;
}

function humanizeSlug(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function classifyUnknownPlugin(slug: string, evidence: Set<string>): CatalogEntry {
  const hasFrontEndAssets = Array.from(evidence).some((e) => e.startsWith("assets:"));
  const hasApi = Array.from(evidence).some((e) => e.startsWith("rest:"));
  if (hasApi) {
    // A custom or uncommon plugin with its own API endpoints usually stores data or
    // processes submissions on the WordPress server — that part can't be copied as files.
    return {
      name: humanizeSlug(slug),
      outcome: "NEEDS_ATTENTION",
      explanation: hasFrontEndAssets
        ? "Its look and front-end behavior were copied, but it also runs code on your WordPress server (its own API). Review the pages that use it before switching your domain."
        : "This plugin runs code on your WordPress server (its own API). Review whether your visitors rely on it before switching your domain.",
    };
  }
  if (hasFrontEndAssets) {
    return {
      name: humanizeSlug(slug),
      outcome: "PRESERVED",
      explanation: "Its styles and scripts were copied, so anything it shows on your pages looks and works the same.",
    };
  }
  return { name: humanizeSlug(slug), outcome: "NOT_NEEDED", explanation: "No visitor-facing trace of this plugin was found — nothing to move." };
}

/**
 * Merges every signal we have about which plugins are active (REST namespaces, plugin
 * asset folders referenced by the rendered pages) into one owner-readable list, worst
 * outcome first so anything blocking a domain switch is at the top of the report.
 */
export function buildPluginReport(namespaces: string[], assetPluginSlugs: Iterable<string>): DetectedPlugin[] {
  const evidence = new Map<string, Set<string>>();
  const add = (slug: string, ev: string) => {
    if (!evidence.has(slug)) evidence.set(slug, new Set());
    evidence.get(slug)!.add(ev);
  };
  for (const ns of namespaces) {
    const slug = pluginSlugForNamespace(ns);
    if (slug) add(slug, `rest:${ns}`);
  }
  for (const slug of assetPluginSlugs) add(slug, `assets:wp-content/plugins/${slug}`);

  const order: Record<PluginOutcome, number> = { NEEDS_ATTENTION: 0, NATIVE: 1, PRESERVED: 2, NOT_NEEDED: 3 };
  return Array.from(evidence.entries())
    .map(([slug, ev]) => {
      const entry = CATALOG[slug] ?? classifyUnknownPlugin(slug, ev);
      return { slug, name: entry.name, outcome: entry.outcome, explanation: entry.explanation, evidence: Array.from(ev) };
    })
    .sort((a, b) => order[a.outcome] - order[b.outcome] || a.name.localeCompare(b.name));
}

/** Plugin folder slugs referenced by a rendered page's assets (…/wp-content/plugins/<slug>/…). */
export function pluginSlugsFromHtml(html: string): Set<string> {
  const slugs = new Set<string>();
  for (const m of html.matchAll(/\/wp-content\/plugins\/([a-z0-9._-]+)\//gi)) slugs.add(m[1].toLowerCase());
  return slugs;
}

/** Active theme (and its parent, for a child theme) from the rendered page's asset paths. */
export function themeSlugsFromHtml(html: string): string[] {
  const slugs: string[] = [];
  for (const m of html.matchAll(/\/wp-content\/themes\/([a-z0-9._-]+)\//gi)) {
    const slug = m[1].toLowerCase();
    if (!slugs.includes(slug)) slugs.push(slug);
  }
  return slugs;
}
