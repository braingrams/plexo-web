import * as cheerio from "cheerio";
import { SiteImportPlatform } from "@prisma/client";

// A static clone can preserve markup/CSS/JS byte-for-byte, but any widget that talks to the
// SOURCE platform's own backend (form submission endpoints, search index, membership/auth,
// cart/checkout) has nothing to talk to once the page is served from Plexo instead — it will
// render but not function. Rather than let that fail silently post-migration, each signature
// below gets surfaced in the import report so the user knows what needs manual rebuilding.
interface FeatureSignature {
  flag: string;
  label: string;
  test: (html: string, $: cheerio.CheerioAPI) => boolean;
}

const WIX_SIGNATURES: FeatureSignature[] = [
  { flag: "wix-form", label: "Contact form (Wix Forms) — will not submit", test: (html) => /wix-forms|wixFormsPublic/i.test(html) },
  {
    flag: "wix-search",
    label: "Site search — powered by Wix's backend, not available",
    test: (_h, $) => $('[data-hook*="search"], [data-testid*="search"]').length > 0,
  },
  {
    flag: "wix-members",
    label: "Membership/login area — removed, page is now public",
    test: (html) => /wixMembersArea|members-area/i.test(html),
  },
  { flag: "wix-cart", label: "Cart/checkout (Wix Stores) — not portable", test: (_h, $) => $('[data-hook="cart-icon"]').length > 0 },
];

const WEBFLOW_SIGNATURES: FeatureSignature[] = [
  { flag: "webflow-form", label: "Form (Webflow Forms) — will not submit", test: (_h, $) => $(".w-form").length > 0 },
  { flag: "webflow-commerce", label: "Cart/checkout (Webflow Ecommerce) — not portable", test: (_h, $) => $('[class*="w-commerce-"]').length > 0 },
  { flag: "webflow-membership", label: "Membership/login gate — removed, page is now public", test: (_h, $) => $("[data-wf-user-badge]").length > 0 },
];

const SQUARESPACE_SIGNATURES: FeatureSignature[] = [
  { flag: "squarespace-form", label: "Form block — will not submit", test: (_h, $) => $(".sqs-block-form").length > 0 },
  { flag: "squarespace-commerce", label: "Cart/checkout (Squarespace Commerce) — not portable", test: (_h, $) => $(".sqs-add-to-cart-button").length > 0 || /squarespace-commerce/i.test(_h) },
];

// WordPress content varies far more (any of hundreds of plugins) — only cheap, reliable
// signatures for the most common ones, explicitly lower-confidence/best-effort.
const WORDPRESS_SIGNATURES: FeatureSignature[] = [
  { flag: "wp-forms", label: "Form plugin (e.g. WPForms/Gravity Forms) — will not submit", test: (_h, $) => $('.wpforms-container, .gform_wrapper, [class*="contact-form"]').length > 0 },
  { flag: "wp-woocommerce", label: "Cart/checkout (WooCommerce) — not portable", test: (html) => /woocommerce/i.test(html) },
];

const SIGNATURES_BY_PLATFORM: Partial<Record<SiteImportPlatform, FeatureSignature[]>> = {
  [SiteImportPlatform.WIX]: WIX_SIGNATURES,
  [SiteImportPlatform.WEBFLOW]: WEBFLOW_SIGNATURES,
  [SiteImportPlatform.SQUARESPACE]: SQUARESPACE_SIGNATURES,
  [SiteImportPlatform.WORDPRESS]: WORDPRESS_SIGNATURES,
};

/** Returns the flags (short codes) matched, for storage on SiteImportPage.interactiveFeatureFlags. */
export function detectInteractiveFeatures(html: string, platform: SiteImportPlatform): string[] {
  const signatures = SIGNATURES_BY_PLATFORM[platform];
  if (!signatures || signatures.length === 0) return [];
  const $ = cheerio.load(html);
  return signatures.filter((sig) => sig.test(html, $)).map((sig) => sig.flag);
}

/** Human-readable labels for the report screen, keyed the same as detectInteractiveFeatures' output. */
export function describeInteractiveFeatureFlag(flag: string): string {
  for (const list of Object.values(SIGNATURES_BY_PLATFORM)) {
    const match = list?.find((sig) => sig.flag === flag);
    if (match) return match.label;
  }
  return flag;
}
