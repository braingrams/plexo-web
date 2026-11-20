import type { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { fixEverything, previewEverything, isAutoFixId, previewFix, setAutoFix, undoEverything } from "@/lib/siteHealth/fixes";
import { setDigestEnabled } from "@/lib/siteHealth/digest";
import { presentHealth } from "@/lib/siteHealth/present";
import { loadHealthStatus, runSiteCheck } from "@/lib/siteHealth/service";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

// A site's speed and AI-visibility check: parity with the dashboard's "Site health" tab.

export const HEALTH_MCP_TOOLS = [
  {
    name: "check_site_health",
    description:
      "Runs a speed and findability check on a site's live address (Google PageSpeed on a phone and a computer: how fast it opens, Core Web Vitals, search, accessibility, plus Plexo's AI-visibility score) and lists the problems found in plain words, biggest first, each with a gain estimate, the steps to fix it by hand, exact page elements when known, and, where Plexo can do it, an autoFix id for apply_site_health_fix. Reuses the last result if it is under 5 minutes old. The site must be published. Read the assistantNote in the result: it says what to tell the owner and offers the fix.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page id (see list_landing_pages)." },
        useLast: { type: "boolean", description: "True returns the last saved result without running a new check." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "apply_site_health_fix",
    description:
      "Previews, applies or undoes Plexo's one-click site health fixes. Fixes apply when pages are served and never rewrite the owner's pages, so undoing one puts everything back. fix is one of: meta_description (writes a search summary from the page), page_title (names pages that have no title: written once with AI from the page, shown in the preview to edit, uses a few AI credits), social_tags (link previews for WhatsApp, Facebook, LinkedIn), llms_txt (a guide file for AI assistants), ai_robots (tells AI crawlers they are welcome), organization_schema (business details for search engines: name, logo, phone, address, opening hours, social profiles. The preview lists what Plexo already knows and the few missing details to ask the owner; pass them back as business), faq_schema (labels questions and answers), alt_text (describes pictures by looking at them, written once with AI, editable, uses a few AI credits; falls back to file names), language (sets the page language), lazy_embeds (videos and maps load when scrolled to), hero_image (the top picture loads first), fast_fonts (text shows while fonts load), smaller_html (trims blank space), image_sizes (gives pictures their size so the page stops jumping), product_schema (shows price and stock in Google for product pages), or all (every fix that applies: use with enabled false to undo them all). Pass preview true first to show the owner what will change in words, then apply. Run check_site_health afterwards to see the new scores.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page id." },
        fix: { type: "string", enum: ["meta_description", "page_title", "social_tags", "llms_txt", "ai_robots", "organization_schema", "faq_schema", "alt_text", "language", "lazy_embeds", "hero_image", "fast_fonts", "smaller_html", "image_sizes", "product_schema", "all"] },
        enabled: { type: "boolean", description: "Default true. False undoes the fix." },
        preview: { type: "boolean", description: "True shows what the fix would change, in plain words, without changing anything." },
        text: { type: "string", description: "For meta_description: the summary to use (40 to 200 characters), usually the one shown in the preview, possibly edited by the owner." },
        business: { type: "object", description: "For organization_schema: the business details the owner confirmed. Fields: kind (local: customers visit a place, or online), name, phone, email, address {street, city, region, postalCode, country}, hours [{days: [0-6, Sunday is 0], opens: \"09:00\", closes: \"17:00\"}], logo, sameAs [profile links]. Ask the owner for anything the preview lists as missing." },
        titles: { type: "object", description: "For page_title: { \"/about\": \"About us | Mama Tee Bakery\" }, the titles from the preview, possibly edited." },
        alts: { type: "object", description: "For alt_text: { \"<picture address>\": \"A chocolate cake on a stand\" }, the descriptions from the preview, possibly edited." },
        regenerate: { type: "boolean", description: "With preview: true on page_title or alt_text, writes the texts again (uses AI credits again)." },
      },
      required: ["templateId", "fix"],
    },
  },
  {
    name: "set_site_health_email",
    description:
      "Turns the weekly \"Your site health\" email on or off for a site. The email goes to the site's owner once a week: how the site is doing, what changed since last week, the 3 things to fix first and a button to open Site health. It is on by default; every email also has an unsubscribe link. check_site_health shows the current setting as settings.emailDigest.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page id." },
        enabled: { type: "boolean", description: "True turns the weekly email on, false turns it off." },
      },
      required: ["templateId", "enabled"],
    },
  },
];

export const HEALTH_TOOL_NAMES = new Set(HEALTH_MCP_TOOLS.map((t) => t.name));

export async function handleHealthTool(toolName: string, args: any, resolved: ResolvedUser): Promise<any> {
  const id = typeof args?.templateId === "string" ? args.templateId.trim() : "";
  if (!id) throw new Error("templateId is required — pass the site's home page id (see list_landing_pages).");
  const { data: site } = await Template.get({ id }).go();
  if (!site || site.organizationId !== resolved.organizationId || site.parentId) {
    throw new Error(`No site found with id "${id}" in this account. Use a site's home page id from list_landing_pages.`);
  }

  if (toolName === "set_site_health_email") {
    if (typeof args?.enabled !== "boolean") throw new Error("enabled must be true (send the weekly email) or false (stop it).");
    await setDigestEnabled({ id: site.id, organizationId: site.organizationId }, args.enabled);
    return { emailDigest: args.enabled, next: args.enabled ? "The weekly Site health email is on. It goes to the site's owner once a week." : "The weekly Site health email is off." };
  }

  if (toolName === "check_site_health") {
    if (args?.useLast === true) return presentHealth(await loadHealthStatus(site.id), { html: site.compiledHtml });
    const outcome = await runSiteCheck({ id: site.id, organizationId: site.organizationId });
    if (!outcome.ok) throw new Error(outcome.error);
    return { ...presentHealth(outcome.status, { html: site.compiledHtml }), cached: outcome.cached, next: "Say what you found in simple words. Offer the fixes marked with an autoFix id (apply_site_health_fix, preview first), and give the steps for the rest. Offer fix \"all\" when several apply." };
  }

  const fixSite = { id: site.id, organizationId: site.organizationId, name: site.name, compiledHtml: site.compiledHtml, userId: resolved.userId };
  const status = await loadHealthStatus(site.id);
  const enabled = args?.enabled !== false;
  if (args?.fix === "all") {
    if (!enabled) {
      const settings = await undoEverything(fixSite, status.settings);
      return { settings, next: "Every fix is off. The pages are back to how the owner built them." };
    }
    const last = status.last?.report ?? null;
    if (!last) throw new Error("Run check_site_health first, so we know what to fix.");
    if (args?.preview === true) return { ...(await previewEverything(fixSite, status.settings, last)), next: "Describe what will change in simple words, then ask if they want everything applied." };
    const { summary, settings } = await fixEverything(fixSite, status.settings, last);
    return { summary, settings, next: "Tell the owner what was done (summary.done) and what was skipped and why. It shows on the live site within a few minutes. Run check_site_health to see the new scores." };
  }
  if (!isAutoFixId(args?.fix)) throw new Error("fix must be one of: meta_description, page_title, social_tags, llms_txt, ai_robots, organization_schema, faq_schema, alt_text, language, lazy_embeds, hero_image, fast_fonts, smaller_html, image_sizes, product_schema, or all.");
  if (args?.preview === true) return { ...(await previewFix(fixSite, args.fix, status.settings, status.last?.report ?? null, { regenerate: args?.regenerate === true })), next: "Describe the changes to the owner in simple words, then ask if they want it applied." };
  const result = await setAutoFix(fixSite, args.fix, enabled, { text: typeof args?.text === "string" ? args.text : undefined, business: args?.business, titles: args?.titles, alts: args?.alts });
  if (!result.ok) throw new Error(result.error);
  return { settings: result.settings, next: enabled ? "On. It shows on the live site within a few minutes. Run check_site_health to see the new scores." : "Off. The page is back to how it was." };
}
