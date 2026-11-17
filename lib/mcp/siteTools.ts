import { SITE_PAGE_TYPES } from "@charisol/plexo-sdk/v2/compile";

import type { resolveUser } from "@/lib/auth/resolveUser";
import { saveSiteLook } from "@/lib/sites/saveLook";
import { createSite, SiteBuildError } from "@/lib/sites/siteBuilder";
import { applyBriefDefaults, mergeBrand } from "@/lib/brand/brandModel";
import { loadProfileBrand } from "@/lib/brand/resolveSiteBrand";
import { applyNewSiteBrandChoice } from "@/lib/brand/siteBrand";
import { findPageCandidates, howToChange, pickPage, rankPages } from "@/lib/sites/findPage";
import { listSiteTemplates } from "@/lib/sites/siteTemplates";
import { MarketplaceUseError, useMarketplaceTemplate } from "@/lib/marketplaceUse";
import { handleBlogTool } from "./blogTools";
import { handleCommerceTool } from "./commerceTools";
import { PageToolError, createV2Page, describePages, editableUrlFor, suggestSubdomains } from "./v2Pages";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

// Whole sites and finding pages — for SOL and any MCP client. site_create builds a complete,
// connected site in one call; list_site_templates / create_site_from_template start from a
// ready-made design; find_page turns "the shop page" into the right page across every site.

const PAGE_TYPES = SITE_PAGE_TYPES.filter((t) => t !== "blogPost");

const sectionContentHelp =
  "Section content uses the field names from the section catalog (page_describe shows it): hero {eyebrow, headline, text, cta:{label,href}, cta2, image}; features {eyebrow, heading, text, items:[{icon, title, text}]}; about {eyebrow, heading, text, text2, image, points}; testimonials {heading, items:[{quote, name, role}]}; pricing {heading, text, items:[{name, price, period, description, features (one per line), cta, highlighted}]}; faq {heading, items:[{question, answer}]}; cta {heading, text, cta}; stats {heading, items:[{value, label}]}; steps {heading, items:[{title, text}]}; team {heading, items:[{name, role, bio}]}; gallery {heading, items:[{image, caption}]}; contact {heading, text, email, phone, address, hours}; shop / blogList {eyebrow, heading, text}.";

export const SITE_MCP_TOOLS = [
  {
    name: "site_create",
    title: "Create a Whole Site",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      "Builds a complete, connected website in ONE call — the way to make any multi-page site, store or blog. From a brief it chooses a brand that fits the business (colours, fonts, corner style — the owner's own colours/fonts/logo win when given) and a fitting layout for each page (different layouts for different industries and styles), writes the business's details into every page, and gives the whole site one shared menu and footer that link its real pages. " +
      "A store page turns selling on with Plexo's own payments (no keys needed) and sets up the shop, checkout, order confirmation, order tracking and product pages, and adds the products you pass. A blog page turns the blog on at /blog with listing and article pages in the site's design, and publishes the posts you pass. Everything is built in the visual editor (editable afterwards with page_describe / page_edit) and nothing is published: call page_publish on the home page (siteId) with a domain when the owner is ready. " +
      "Write real copy for every page in pages[].content (keyed by section kind, e.g. {hero:{headline,text,cta}, features:{items:[...]}}, or \"hero#2\" for a page's second hero) — anything you leave out keeps sample wording. " +
      sectionContentHelp +
      " Unknown fields are skipped and reported in warnings — pass them on to the owner only if they matter. " +
      "BRAND: a brief with no colours, fonts or logo gets the owner's saved brand (their account's), so don't ask them for these. For a new site the owner can instead use one of their Strata projects: pass strataProjectId (from list_strata_projects) and the new site is linked to it right after it is built, so it uses that brand and follows it from the start.",
    inputSchema: {
      type: "object",
      properties: {
        strataProjectId: { type: "string", description: "Optional. One of the owner's Strata projects (list_strata_projects). The new site is linked to it, using its colours, fonts and logo, and stays in sync." },
        brief: {
          type: "object",
          description: "Who the site is for. name is required; the more you fill in, the more tailored the result.",
          properties: {
            name: { type: "string", description: "The business's name." },
            about: { type: "string", description: "What they do and for whom, in a sentence or two (used in the opening, about section and footer)." },
            tagline: { type: "string", description: "A short promise for the home page headline." },
            industry: { type: "string", description: "e.g. bakery, law firm, gym, software, boutique, charity, photographer." },
            tone: { type: "string", description: "The feel: e.g. warm & friendly, bold, elegant/luxury, playful, minimal, professional, dark." },
            colors: { type: "array", items: { type: "string" }, description: "Brand colours, most important first: hex (#0F766E) or plain names (navy, gold)." },
            fonts: { type: "object", properties: { heading: { type: "string" }, body: { type: "string" } }, description: "Optional Google font names." },
            logoUrl: { type: "string", description: "A public logo image address (use_attached_image gives one for an attached logo)." },
            contact: { type: "object", properties: { email: { type: "string" }, phone: { type: "string" }, address: { type: "string" }, hours: { type: "string" } } },
            socials: { type: "array", items: { type: "object", properties: { network: { type: "string", description: "facebook, instagram, x, linkedin, youtube, tiktok, whatsapp, pinterest…" }, url: { type: "string" } }, required: ["network", "url"] } },
          },
          required: ["name"],
        },
        pages: {
          type: "array",
          maxItems: 12,
          description: `The pages, home first. type is one of: ${PAGE_TYPES.join(", ")}. Omit pages to get a sensible set for the goal.`,
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: PAGE_TYPES },
              name: { type: "string", description: "Menu label / page name (default from the type, e.g. \"Shop\")." },
              layout: { type: "string", description: "Optional layout id from list_site_templates' pageLayouts (default: the best fit for the brief)." },
              content: { type: "object", additionalProperties: { type: "object" }, description: "The business's words per section kind, e.g. {\"hero\":{\"headline\":\"…\",\"text\":\"…\",\"cta\":{\"label\":\"Book a table\",\"href\":\"/contact\"}}}." },
              sections: { type: "array", items: { type: "object", properties: { kind: { type: "string" }, variant: { type: "string" }, content: { type: "object" }, background: { type: "string" } }, required: ["kind"] }, description: "Optional: your own section list instead of the layout's." },
            },
            required: ["type"],
          },
        },
        goal: { type: "string", enum: ["store", "business-site", "blog", "course", "landing", "link-in-bio"], description: "Used only when pages is omitted." },
        navCta: { type: "object", properties: { label: { type: "string" }, href: { type: "string" } }, description: "The button in the menu (default: Shop now for a store, Get in touch otherwise)." },
        store: {
          type: "object",
          description: "Products for the shop (also implies a store page).",
          properties: {
            currency: { type: "string", description: "Three-letter currency, e.g. NGN, USD, GBP (default NGN)." },
            products: { type: "array", maxItems: 12, items: { type: "object", properties: { name: { type: "string" }, price: { type: "number", description: "In whole currency units, e.g. 15000 for ₦15,000." }, description: { type: "string" }, imageUrl: { type: "string" }, kind: { type: "string", enum: ["PHYSICAL", "DIGITAL", "SERVICE"] }, category: { type: "string" } }, required: ["name", "price"] } },
          },
        },
        blog: {
          type: "object",
          description: "The blog's title and first posts (also implies a blog page). Without posts it gets one short welcome post.",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            posts: { type: "array", maxItems: 6, items: { type: "object", properties: { title: { type: "string" }, excerpt: { type: "string" }, contentHtml: { type: "string", description: "Plain HTML: <p>, <h2>, <ul>, <a>, <strong>…" }, categoryNames: { type: "array", items: { type: "string" } } }, required: ["title", "contentHtml"] } },
          },
        },
      },
      required: ["brief"],
    },
  },
  {
    name: "list_site_templates",
    title: "List Site Templates",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Lists ready-made starting points that fit a brief, best first, each tagged with the industry and style it suits: premiumTemplates (complete designer-made sites from the marketplace — free, owned, or with a price; use create_site_from_template) and pageLayouts (the built-in layouts per page type — pass one as a page's layout in site_create, or as templateId in page_create_from_template). Use it when the owner wants a particular look or to see options; offer the best two or three with ask_user_question.",
    inputSchema: {
      type: "object",
      properties: {
        industry: { type: "string", description: "What the business is, e.g. restaurant, salon, software, boutique." },
        style: { type: "string", description: "The feel, e.g. elegant, bold, playful, minimal, warm." },
        query: { type: "string", description: "Optional words to match (e.g. \"wedding\", \"portfolio\")." },
        pageType: { type: "string", enum: PAGE_TYPES, description: "Only layouts for this page type." },
        limit: { type: "number", description: "How many premium templates (default 8, at most 20)." },
      },
    },
  },
  {
    name: "create_site_from_template",
    title: "Create Site From Template",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      "Copies a premium/marketplace site template (from list_site_templates) into the owner's account as a new site, ready to personalise: then use page_describe and page_edit to put in the business's words, colours (setBrand) and pictures, and page_publish to put it live. Only free templates or ones the owner already bought can be used — for a paid one, give them its previewUrl to buy it first.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The premium template's templateId from list_site_templates." },
        name: { type: "string", description: "The new site's name (usually the business's name)." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "find_page",
    title: "Find a Page",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Finds the page the owner means from their own words — \"the shop page\", \"pricing\", \"the about page on Crumbs\", \"my homepage\", \"the menu\", \"checkout\" — across ALL their sites, no ids needed (pass siteId only to limit it to one site). Works for every kind of page: visual, classic and hand-written pages, the shop/checkout/order pages, the product page every product uses, the blog's listing and post pages, and the shared menu and footer. " +
      "When it's clear which page, it returns the page with what's on it (sections for a visual page, a text outline for the others) and how to change it. When it's genuinely unclear (two sites both have a shop page), it returns the candidates — ask the owner which one with ask_user_question.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the owner called it, in their words." },
        siteId: { type: "string", description: "Optional: only look in this site (its home page id)." },
      },
      required: ["query"],
    },
  },
  {
    name: "site_save_look",
    title: "Save a Site's Logo and Colours",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Saves the owner's logo and colours as THIS site's brand (the same as the Brand tab's \"Colours and logo\" card) and applies them to the site's pages, so every page stays consistent and Home's \"logo and colours\" step ticks. Only call it after the owner agreed to save them. Pass colours as hex (main colour first, optionally a second), and either logoUrl (a public address, e.g. from use_attached_image) or noLogo true when they have no logo (a wordmark is made from the name). Returns a plain sentence saying what was applied.",
    inputSchema: {
      type: "object",
      properties: {
        siteId: { type: "string", description: "The site's home page id." },
        colors: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Hex colours, main first, e.g. [\"#C2410C\", \"#F59E0B\"]." },
        logoUrl: { type: "string", description: "A public https address of their logo." },
        noLogo: { type: "boolean", description: "True when they have no logo." },
      },
      required: ["siteId", "colors"],
    },
  },
];

export const SITE_TOOL_NAMES = new Set(SITE_MCP_TOOLS.map((t) => t.name));

async function findPage(resolved: ResolvedUser, args: { query?: unknown; siteId?: unknown }) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) throw new Error("Say which page to look for, in the owner's words (e.g. \"the shop page\").");
  const siteId = typeof args.siteId === "string" && args.siteId.trim() ? args.siteId.trim() : undefined;
  const candidates = await findPageCandidates(resolved, siteId);
  if (!candidates.length) {
    return { found: false, message: siteId ? "That site has no pages I can find." : "This account has no sites yet — build one with site_create." };
  }
  const ranked = rankPages(query, candidates);
  const { match, tied } = pickPage(ranked);
  const brief = (c: (typeof candidates)[number]) => ({ templateId: c.templateId, siteId: c.siteId, site: c.siteName, name: c.name, route: c.route, kind: c.kind, designFormat: c.designFormat });
  if (!match) {
    if (tied.length) {
      return { found: false, ambiguous: true, candidates: tied.slice(0, 8).map(brief), next: "More than one page fits. Ask the owner which one (ask_user_question, naming the sites/pages in plain words), then call find_page again with siteId or a more specific query." };
    }
    return { found: false, candidates: candidates.slice(0, 40).map(brief), next: "No page matched those words. Here are the account's pages — pick the one meant, or ask the owner." };
  }
  let details: unknown;
  try {
    details = await describePages(resolved, { templateId: match.templateId, includeCatalog: false });
  } catch (err) {
    details = { note: err instanceof Error ? err.message : "I couldn't read this page's contents." };
  }
  const others = ranked.filter((r) => r.templateId !== match.templateId).slice(0, 3).map(brief);
  return {
    found: true,
    page: { ...brief(match), editableUrl: editableUrlFor(match.templateId) },
    details,
    howToChange: howToChange(match),
    ...(others.length ? { alsoConsidered: others } : {}),
  };
}

export async function handleSiteTool(toolName: string, args: any, resolved: ResolvedUser): Promise<any> {
  try {
    switch (toolName) {
      case "site_create": {
        // Missing colours, fonts and logo come from the owner's saved brand (the lowest rung of the precedence rule); a caller's own values always win.
        const input: Record<string, any> = { ...(args ?? {}) };
        let defaulted: string[] = [];
        if (input.brief && typeof input.brief === "object" && !Array.isArray(input.brief)) {
          const applied = applyBriefDefaults(input.brief, mergeBrand({ profile: await loadProfileBrand(resolved.userId) }));
          input.brief = applied.brief;
          defaulted = applied.filled;
        }
        const result = await createSite(resolved, input, {
          createPage: (pageArgs, opts) => createV2Page(resolved, pageArgs, opts),
          commerceTool: (name, toolArgs) => handleCommerceTool(name, toolArgs, resolved),
          blogTool: (name, toolArgs) => handleBlogTool(name, toolArgs, resolved),
        });
        const strataProjectId = typeof args?.strataProjectId === "string" ? args.strataProjectId.trim() : "";
        const brand = strataProjectId ? await applyNewSiteBrandChoice({ siteId: result.siteId, userId: resolved.userId, organizationId: resolved.organizationId, choice: { projectId: strataProjectId } }) : undefined;
        return {
          success: true,
          ...result,
          ...(brand ? { strataBrand: brand.ok ? { linked: true, project: brand.project } : { linked: false, note: brand.message } } : {}),
          ...(defaulted.length ? { brandDefaults: `Filled from the owner's saved brand: ${defaulted.join(", ")}.` } : {}),
          pages: result.pages.map((p) => ({ ...p, editableUrl: editableUrlFor(p.templateId) })),
          editableUrl: editableUrlFor(result.siteId),
          publishedUrl: null,
          suggestedDomains: suggestSubdomains(result.name),
          next:
            "Built, not published. Tell the owner what you made (pages, the look) in a few lines. To put it live: page_publish with templateId = siteId and a domain (offer suggestedDomains with ask_user_question), then page_publish each other page. To refine a page: page_describe then page_edit.",
        };
      }
      case "site_save_look": {
        const siteId = typeof args?.siteId === "string" ? args.siteId.trim() : "";
        if (!siteId) throw new Error("Say which site to save the logo and colours for.");
        const result = await saveSiteLook(resolved, siteId, { colors: args?.colors, logoUrl: args?.logoUrl, logoSkipped: args?.noLogo === true });
        if (result.status !== 200) throw new Error(String((result.body as { error?: string }).error ?? "We couldn't save your logo and colours."));
        return { success: true, ...result.body };
      }
      case "list_site_templates":
        return await listSiteTemplates(resolved.userId, args ?? {});
      case "create_site_from_template": {
        const templateId = typeof args?.templateId === "string" ? args.templateId.trim() : "";
        if (!templateId) throw new Error("Which template? Pass a templateId from list_site_templates.");
        const created = await useMarketplaceTemplate(resolved, templateId, { name: typeof args?.name === "string" ? args.name : undefined });
        if (created.kind !== "LANDING_PAGE") throw new Error("That's an email template, not a site. Pick one of list_site_templates' premiumTemplates.");
        return {
          success: true,
          siteId: created.id,
          templateId: created.id,
          name: created.name,
          editableInVisualEditor: created.designFormat === "v2",
          editableUrl: editableUrlFor(created.id),
          publishedUrl: null,
          suggestedDomains: suggestSubdomains(created.name),
          next:
            created.designFormat === "v2"
              ? "Copied. Now make it theirs: page_describe (templateId = siteId), then page_edit with their words, a setBrand command for their colours/fonts, and their pictures. Then page_publish with a domain."
              : "Copied. This design uses the classic editor: change it with update_template (or rebuild it with site_create for a fully editable version). Then publish_existing_landing_page.",
        };
      }
      case "find_page":
        return await findPage(resolved, args ?? {});
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (err) {
    if (err instanceof PageToolError || err instanceof SiteBuildError || err instanceof MarketplaceUseError) throw new Error(err.message);
    throw err;
  }
}
