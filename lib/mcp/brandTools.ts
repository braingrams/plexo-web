import type { resolveUser } from "@/lib/auth/resolveUser";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { Template } from "@/lib/db/contentEntities";
import { brandForClient, tokensForClient, type TokenRequest } from "@/lib/brand/brandModel";
import { buildComponentRow, ComponentInputError, usageHint } from "@/lib/brand/brandComponents";
import { sendComponentsToStrata, sendTokensToStrata } from "@/lib/brand/extrasWriteThrough";
import { resolveSiteBrand, siteIdOfPage } from "@/lib/brand/resolveSiteBrand";
import { saveSiteVoice, VoiceError } from "@/lib/brand/voiceStore";
import { TONES } from "@/lib/brand/brandVoice";
import { BrandError, createStrataProjectFromSiteBrand, getSiteBrandState, linkedDesignSystem, linkSiteBrand, listOwnerStrataProjects } from "@/lib/brand/siteBrand";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

// The site's brand for SOL and any external AI (Claude, ChatGPT, Cursor). Thin: every rule lives in lib/brand (the same shared
// functions the dashboard's Brand tab calls), and the same limits apply as on the web (20 changes per window, 120 reads).

const siteIdProp = { type: "string", description: "The site (its home page id from list_landing_pages). Optional when the owner has only one site." };

export const BRAND_MCP_TOOLS = [
  {
    name: "get_site_brand",
    title: "Get a Site's Brand",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Reads the brand a site uses RIGHT NOW: colours with their roles (primary, secondary, accent, text, background), fonts, corner radius, logo, voice, which Strata project it is linked to and whether it stays in sync automatically. Precedence: the linked Strata project, then the site's own saved brand, then the account's onboarding brand. " +
      "Call this FIRST whenever you are about to create or change anything for a site (pages, sections, emails, blog or store layouts, funnel pages, apps). If a brand comes back, use it by default and never ask the owner for colours, fonts or a logo; tell them once \"I'll use your <brand> brand\". The visual-editor tools and site_create already default to it when you pass no colours or fonts.",
    inputSchema: { type: "object", properties: { siteId: siteIdProp } },
  },
  {
    name: "list_strata_projects",
    title: "List the Owner's Strata Projects",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description:
      "Lists the owner's Strata projects (their brand and design-system projects, with a main colour and logo when Strata has them). Use it to offer \"use one of your Strata brands\" when starting a NEW site or when a site has no brand linked yet. Returns connected:false when the owner hasn't connected Strata (or their sign-in ran out): in that case say nothing about Strata, just carry on with their own brand, or tell them they can connect it from the site's Brand page.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "link_site_brand",
    title: "Use a Strata Project as a Site's Brand",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description:
      "Links a site to one of the owner's Strata projects (projectId from list_strata_projects). From then on the whole site uses that project's colours, fonts and tokens, whatever it is made of, and it follows the project when the owner publishes in Strata (autoSync, on by default). Pages are rebuilt once so they defer to the brand. Replaces any project the site used before. Only for the owner's own sites and projects.",
    inputSchema: {
      type: "object",
      properties: {
        siteId: siteIdProp,
        projectId: { type: "string", description: "The Strata project id (from list_strata_projects)." },
        autoSync: { type: "boolean", description: "Keep the site up to date when the project is published in Strata. Default true." },
      },
      required: ["projectId"],
    },
  },
  {
    name: "create_strata_project_from_brand",
    title: "Create a Strata Project From a Site's Brand",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description:
      "Makes a NEW Strata project in the owner's Strata account from the site's current brand (main colour, second colour, fonts, logo) and links the site to it with auto-sync on, so the brand lives in Strata and stays in step from now on. Use it when the site has a brand but no Strata project and the owner wants it kept in Strata. Fails with a plain explanation if the site already uses a Strata project, has no colours yet, or Strata isn't connected.",
    inputSchema: {
      type: "object",
      properties: {
        siteId: siteIdProp,
        name: { type: "string", description: "The new project's name. Default: the site's name." },
        autoSync: { type: "boolean", description: "Keep the site up to date when the project is published in Strata. Default true." },
      },
    },
  },
  {
    name: "list_brand_components",
    title: "List a Site's Brand Components",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Lists the ready-made components of a site's brand (a button, a card, a banner...): their names, looks (variants) and the parts you fill in (slots), and exactly how to use each on a page. The brand lives in Strata and these come from the linked Strata project, so they are the owner's own design. " +
      "USE THEM FIRST: before you hand-build a button, card or similar, call this and use the brand's own; tell the owner once \"I'll use your brand's <name>\". On a page a component is an element with the class plx-brand-<name> (and plx-brand-<name>--<look>), styled by the site's hosted brand sheet. When you build something reusable that isn't here, offer to save it with create_brand_component.",
    inputSchema: { type: "object", properties: { siteId: siteIdProp } },
  },
  {
    name: "create_brand_component",
    title: "Save a Component to a Site's Brand",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description:
      "Saves a reusable component (a button, a card, a banner, a pricing box...) to the site's brand in Strata, so every page and every tool can use it and it goes live on the site straight away. Needs a site whose brand is linked to a Strata project. " +
      "Describe it with the brand's own variables rather than fixed colours: styles {\"padding\":\"var(--space-5)\",\"background-color\":\"var(--color-bg-surface)\",\"border-radius\":\"var(--radius-lg)\"} (read them with get_brand_tokens). variants are other looks that change only some styles, e.g. {\"raised\":{\"box-shadow\":\"var(--shadow-md)\"}}. slots are the text parts inside it: [{\"role\":\"title\",\"tag\":\"h3\",\"text\":\"Card title\",\"styles\":{...}}]. Only plain structure and text are allowed (no scripts, embeds or images yet). " +
      "If the brand already has a component with that name, nothing is overwritten unless you pass replace:true, and only do that when the owner agreed. Offer to save things you built (\"Want me to save this card to your brand so you can reuse it?\") instead of saving without asking. If Strata can't be reached the component is kept and sent automatically.",
    inputSchema: {
      type: "object",
      properties: {
        siteId: siteIdProp,
        name: { type: "string", description: "Short name, letters and numbers: button, card, banner. It becomes the class plx-brand-<name>." },
        tag: { type: "string", description: "The outer element: div (default), section, article, button, a, span, p, ul, li..." },
        styles: { type: "object", description: "CSS for the outer element, property -> value. Prefer var(--token) values." },
        variants: { type: "object", description: "Other looks: name -> the styles that change, e.g. {\"secondary\": {\"background-color\": \"transparent\"}}." },
        slots: {
          type: "array",
          maxItems: 12,
          description: "The text parts inside: role (title, body, label...), tag (h1-h6, p, span, a, small, strong, em, li, label, button), text (sample words), styles.",
          items: { type: "object", properties: { role: { type: "string" }, tag: { type: "string" }, text: { type: "string" }, styles: { type: "object" } }, required: ["role"] },
        },
        replace: { type: "boolean", description: "Update the component if the brand already has one with this name. Only with the owner's agreement." },
      },
      required: ["name", "styles"],
    },
  },
  {
    name: "get_brand_voice",
    title: "Get a Site's Tagline and Brand Voice",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Reads the WORDS of a site's brand: its tagline, a short \"about us\" line, and how it sounds (tones, formality, who it speaks to, words they like and words they avoid). Strata's project has no tagline or voice fields, so Plexo keeps these on the site (and copies them into the linked Strata project when there is one). " +
      "Call it before you write ANY copy for the site (page text, emails, blog posts, product descriptions, ads) and write in that voice without being asked; use the tagline as is where a tagline belongs (header, footer, hero, meta description). If nothing is set, offer once to set it with set_brand_voice, writing the proposal yourself from what the owner told you.",
    inputSchema: { type: "object", properties: { siteId: siteIdProp } },
  },
  {
    name: "set_brand_voice",
    title: "Set a Site's Tagline and Brand Voice",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description:
      "Saves the words of a site's brand so SOL and every AI helper write in them from now on, and the site's footer and search description can start from them. Pass only what should change: a field you pass replaces the old one (\"\" or [] clears it), a field you leave out stays. " +
      "Write them yourself from what the owner said (don't ask them to fill a form): tagline (max 8 words, specific, no buzzwords), aboutLine (one or two plain sentences), tones (up to 4 of: " + TONES.map((t) => t.id).join(", ") + "), formality (casual, balanced, formal), audience (a short phrase), wordsLike and wordsAvoid (short lists). Only change them when the owner asked or agreed to your proposal. Never invent facts (years in business, awards, prices).",
    inputSchema: {
      type: "object",
      properties: {
        siteId: siteIdProp,
        tagline: { type: "string", description: "A short line that goes with the name, max 90 characters." },
        aboutLine: { type: "string", description: "One or two sentences about the business, max 240 characters." },
        tones: { type: "array", items: { type: "string", enum: TONES.map((t) => t.id) }, maxItems: 4, description: "How it sounds." },
        formality: { type: "string", enum: ["casual", "balanced", "formal", ""], description: "How formal." },
        audience: { type: "string", description: "Who it speaks to, max 160 characters." },
        wordsLike: { type: "array", items: { type: "string" }, description: "Words and phrases to use where they fit." },
        wordsAvoid: { type: "array", items: { type: "string" }, description: "Words and phrases never to use." },
      },
    },
  },
  {
    name: "get_brand_tokens",
    title: "Get a Site's Brand Tokens",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Reads the linked Strata project's design tokens for a site (colours, fonts, corner radius, spacing, shadows...) as Plexo holds them, with references resolved. Use the variable names in styles (var(--color-action-primary)) so what you make follows the brand. For the plain summary (main colour, fonts, logo) use get_site_brand. Returns linked:false when the site has no Strata project; then use get_site_brand.",
    inputSchema: { type: "object", properties: { siteId: siteIdProp } },
  },
  {
    name: "set_brand_tokens",
    title: "Change a Site's Brand Colours, Fonts, Corners or Spacing",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description:
      "Changes the brand in the site's Strata project and publishes it, so the whole site (and every other tool that uses the brand) follows: colours by role (primary, secondary, accent, text, background, surface as hex), fonts (heading, body: a font name like Inter), radius (corner roundness in px) and spacing (steps in px). Only existing tokens and the standard ones are changed; ramps are computed by Strata. Plexo keeps its copy and sends it automatically if Strata can't be reached. Only change the brand when the owner asked; to just read it use get_brand_tokens.",
    inputSchema: {
      type: "object",
      properties: {
        siteId: siteIdProp,
        colours: { type: "object", description: "Role -> hex, e.g. {\"primary\":\"#E4572E\",\"background\":\"#FFF8F0\"}. Roles: primary, secondary, accent, text, background, surface." },
        fonts: { type: "object", description: "{\"heading\":\"Playfair Display\",\"body\":\"Inter\"}. Any Google Fonts family works (about 1,800 of them), or a font the owner uploaded. Pair a classic heading font with a clean body font, e.g. Playfair Display with Source Sans 3." },
        fontWeights: { type: "object", description: "How heavy each font is, 100 to 900: {\"heading\":700,\"body\":400}. Only weights the font really has are loaded." },
        radius: { type: "number", description: "Corner roundness in px (0 to 64)." },
        spacing: { type: "object", description: "Step -> px, e.g. {\"4\": 16, \"6\": 24}." },
      },
    },
  },
];

export const BRAND_TOOL_NAMES = new Set(BRAND_MCP_TOOLS.map((t) => t.name));

/** The site a call is about: the id given (a page id is mapped to its site), else the owner's only site. */
export async function pickSiteId(resolved: ResolvedUser, given: unknown): Promise<string> {
  const id = typeof given === "string" ? given.trim() : "";
  if (id) {
    const siteId = await siteIdOfPage(id);
    const { data } = await Template.get({ id: siteId }).go({ attributes: ["id", "organizationId", "parentId"] });
    if (!data || data.organizationId !== resolved.organizationId) throw new BrandError("That site wasn't found in this account.", 404);
    return data.id;
  }
  const { data } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all", attributes: ["id", "name", "kind", "parentId", "isBlogLayout", "isSiteLayoutFragment", "isCommerceLayout", "isLmsPageDesign"] });
  const sites = data.filter((t) => !t.parentId && t.kind === "LANDING_PAGE" && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout && !t.isLmsPageDesign);
  if (sites.length === 1) return sites[0].id;
  if (!sites.length) throw new BrandError("This account has no site yet. Build one with site_create first.", 404);
  throw new BrandError(`Which site? Pass siteId. Their sites: ${sites.slice(0, 12).map((s) => `${s.name ?? "Untitled"} (${s.id})`).join("; ")}.`, 400);
}

const limited = async (resolved: ResolvedUser, bucket: string, limit: number) => {
  if (!(await checkCommerceRateLimit(`${bucket}:${resolved.userId}`, limit))) throw new BrandError("That's a lot of brand changes in a short time. Wait a few minutes and try again.", 429);
};

/** What set_brand_tokens was asked, checked for shape (the values themselves are checked where they are applied). */
function readTokenRequest(args: any): TokenRequest {
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
  const req: TokenRequest = {};
  const colours = obj(args?.colours);
  if (colours) req.colours = Object.fromEntries(Object.entries(colours).filter(([, v]) => typeof v === "string")) as TokenRequest["colours"];
  const fonts = obj(args?.fonts);
  if (fonts) req.fonts = Object.fromEntries(Object.entries(fonts).filter(([k, v]) => (k === "heading" || k === "body") && typeof v === "string"));
  const weights = obj(args?.fontWeights);
  if (weights) req.fontWeights = Object.fromEntries(Object.entries(weights).filter(([k, v]) => (k === "heading" || k === "body") && (typeof v === "number" || typeof v === "string")));
  if (typeof args?.radius === "number" || typeof args?.radius === "string") req.radius = args.radius;
  const spacing = obj(args?.spacing);
  if (spacing) req.spacing = Object.fromEntries(Object.entries(spacing).filter(([, v]) => typeof v === "number" || typeof v === "string")) as TokenRequest["spacing"];
  const nothing = !Object.keys(req.colours ?? {}).length && !Object.keys(req.fonts ?? {}).length && !Object.keys(req.fontWeights ?? {}).length && req.radius === undefined && !Object.keys(req.spacing ?? {}).length;
  if (nothing) throw new BrandError("Say what to change: colours (like primary), fonts (heading, body), fontWeights, radius or spacing.", 400);
  return req;
}

export async function handleBrandTool(toolName: string, args: any, resolved: ResolvedUser): Promise<any> {
  try {
    switch (toolName) {
      case "get_site_brand": {
        const siteId = await pickSiteId(resolved, args?.siteId);
        const [brand, state] = await Promise.all([resolveSiteBrand({ siteId, organizationId: resolved.organizationId, userId: resolved.userId }), getSiteBrandState(siteId)]);
        if (!brand) throw new BrandError("That site wasn't found in this account.", 404);
        return { success: true, ...brandForClient(brand), lastSync: state.linked ? { result: state.lastResult, checkedAt: state.lastCheckedAt, updatedAt: state.updatedAt } : null };
      }
      case "list_strata_projects": {
        await limited(resolved, "strata:projects", 120);
        const list = await listOwnerStrataProjects(resolved.userId);
        if (!list.available) return { success: true, connected: false, projects: [], note: "Strata isn't set up on this Plexo. Carry on with the owner's own brand." };
        if (!list.connected) return { success: true, connected: false, projects: [], note: "The owner hasn't connected Strata (or their sign-in ran out). They can connect it from the site's Brand page. Carry on with their own brand." };
        return { success: true, connected: true, projects: list.projects, next: list.projects.length ? "Offer these by name; link the chosen one with link_site_brand (or pass its id as strataProjectId to site_create)." : "They have no Strata project yet. create_strata_project_from_brand can make one from a site's brand." };
      }
      case "link_site_brand": {
        const projectId = typeof args?.projectId === "string" ? args.projectId.trim() : "";
        if (!projectId || projectId.length > 200) throw new BrandError("Pass the Strata projectId from list_strata_projects.", 400);
        const siteId = await pickSiteId(resolved, args?.siteId);
        await limited(resolved, "site-brand", 20);
        await linkSiteBrand({ siteId, userId: resolved.userId, organizationId: resolved.organizationId, projectId, autoSync: args?.autoSync !== false });
        const brand = await resolveSiteBrand({ siteId, organizationId: resolved.organizationId, userId: resolved.userId });
        return { success: true, ...(brand ? brandForClient(brand) : {}), next: "The whole site now uses this brand and follows it when it is published in Strata. Tell the owner in one plain line." };
      }
      case "create_strata_project_from_brand": {
        const siteId = await pickSiteId(resolved, args?.siteId);
        await limited(resolved, "site-brand", 20);
        await limited(resolved, "strata:projects:create", 20);
        const made = await createStrataProjectFromSiteBrand({ siteId, userId: resolved.userId, organizationId: resolved.organizationId, name: typeof args?.name === "string" ? args.name : undefined, autoSync: args?.autoSync !== false });
        const brand = await resolveSiteBrand({ siteId, organizationId: resolved.organizationId, userId: resolved.userId });
        return { success: true, project: made.project, sent: made.sent, notes: made.notes, ...(brand ? brandForClient(brand) : {}), next: "The brand is now in their Strata and linked to the site with auto-sync on. Tell the owner in one plain line." };
      }
      case "list_brand_components": {
        await limited(resolved, "brand:read", 120);
        const siteId = await pickSiteId(resolved, args?.siteId);
        const brand = await resolveSiteBrand({ siteId, organizationId: resolved.organizationId, userId: resolved.userId });
        if (!brand) throw new BrandError("That site wasn't found in this account.", 404);
        return {
          success: true,
          siteId,
          linked: brand.linked,
          stylesheet: brand.stylesheet,
          components: brand.components.map((c) => ({ ...c, howToUse: usageHint(c) })),
          next: !brand.linked
            ? "This site's brand isn't in Strata, so it has no ready-made components. Carry on building; if the owner wants their brand kept in Strata, create_strata_project_from_brand does it."
            : brand.components.length
              ? "Use these before building your own, and tell the owner once \"I'll use your brand's <name>\". When you build something reusable that isn't here, offer to save it with create_brand_component."
              : "The brand has no components yet. When you build something reusable (a button, a card, a banner), offer to save it with create_brand_component so it is in Strata for every page.",
        };
      }
      case "create_brand_component": {
        const siteId = await pickSiteId(resolved, args?.siteId);
        await limited(resolved, "site-brand", 20);
        await limited(resolved, "brand:components", 20);
        const before = await resolveSiteBrand({ siteId, organizationId: resolved.organizationId, userId: resolved.userId });
        if (!before) throw new BrandError("That site wasn't found in this account.", 404);
        if (!before.linked) throw new BrandError("This site's brand isn't in Strata yet, so there is nowhere to keep a component. Use create_strata_project_from_brand (or link_site_brand) first.", 409);
        const tokens = ((await linkedDesignSystem(siteId))?.tokens ?? []).map((t) => t.key);
        let row;
        try {
          row = buildComponentRow(args ?? {}, tokens.length ? tokens : null);
        } catch (err) {
          if (err instanceof ComponentInputError) throw new BrandError(err.message, 400);
          throw err;
        }
        if (before.components.some((c) => c.name.toLowerCase() === row.name.toLowerCase()) && args?.replace !== true) {
          throw new BrandError(`The brand already has a "${row.name}". Use that one, pick another name, or pass replace:true to update it (only if the owner agreed).`, 409);
        }
        const sent = await sendComponentsToStrata({ siteId, userId: resolved.userId, organizationId: resolved.organizationId, components: [row] });
        if (sent.state === "refused" || sent.state === "not-set-up") throw new BrandError(sent.message, 409);
        const after = await resolveSiteBrand({ siteId, organizationId: resolved.organizationId, userId: resolved.userId });
        const info = after?.components.find((c) => c.name.toLowerCase() === row.name.toLowerCase());
        const className = `plx-brand-${row.name}`;
        return {
          success: true,
          state: sent.state,
          message: sent.state === "in-strata" ? `Saved "${row.name}" to the brand in Strata. It is live on the site.` : `Saved "${row.name}" here; it will go to Strata automatically.`,
          component: info ? { ...info, howToUse: usageHint(info) } : { name: row.name, className },
          next: `Use it as an element with class "${className}". Tell the owner in one plain line that it is saved to their brand${sent.state === "waiting" ? " and will reach Strata shortly" : " and in Strata"}.`,
        };
      }
      case "get_brand_voice": {
        await limited(resolved, "brand:read", 120);
        const siteId = await pickSiteId(resolved, args?.siteId);
        const brand = await resolveSiteBrand({ siteId, organizationId: resolved.organizationId, userId: resolved.userId });
        if (!brand) throw new BrandError("That site wasn't found in this account.", 404);
        return {
          success: true,
          siteId,
          tagline: brand.tagline ?? null,
          words: brand.words ?? null,
          summary: brand.voice ?? null,
          next: brand.words ? "Write all copy for this site in this voice, without being asked, and use the tagline as is. Change it only with set_brand_voice and only when the owner asked." : "No tagline or voice is set. Offer once to set them: propose a tagline and voice from what the owner told you and save it with set_brand_voice once they agree.",
        };
      }
      case "set_brand_voice": {
        const siteId = await pickSiteId(resolved, args?.siteId);
        await limited(resolved, "site-voice", 30);
        const { siteId: _ignored, ...patch } = (args ?? {}) as Record<string, unknown>;
        void _ignored;
        if (!Object.keys(patch).length) throw new BrandError("Say what to change: tagline, aboutLine, tones, formality, audience, wordsLike or wordsAvoid.", 400);
        try {
          const saved = await saveSiteVoice({ siteId, userId: resolved.userId, organizationId: resolved.organizationId, patch });
          return { success: true, state: saved.state, message: saved.message, words: saved.voice, next: "Tell the owner in one plain line that their words are saved and everything will be written in that voice." };
        } catch (err) {
          if (err instanceof VoiceError) throw new BrandError(err.message, err.status);
          throw err;
        }
      }
      case "get_brand_tokens": {
        await limited(resolved, "brand:read", 120);
        const siteId = await pickSiteId(resolved, args?.siteId);
        const brand = await resolveSiteBrand({ siteId, organizationId: resolved.organizationId, userId: resolved.userId });
        if (!brand) throw new BrandError("That site wasn't found in this account.", 404);
        if (!brand.linked) return { success: true, linked: false, tokens: [], next: "This site's brand isn't in Strata. Use get_site_brand for its colours, or create_strata_project_from_brand to keep the brand in Strata." };
        const ds = await linkedDesignSystem(siteId);
        return {
          success: true,
          linked: true,
          project: brand.project,
          tokens: tokensForClient(ds),
          next: "Use these variables in your styles, e.g. var(--color-action-primary). To change the brand use set_brand_tokens (colours, fonts, radius, spacing), and only when the owner asked.",
        };
      }
      case "set_brand_tokens": {
        const request = readTokenRequest(args);
        const siteId = await pickSiteId(resolved, args?.siteId);
        await limited(resolved, "site-brand", 20);
        const sent = await sendTokensToStrata({ siteId, userId: resolved.userId, organizationId: resolved.organizationId, request });
        if (sent.state === "refused" || sent.state === "not-set-up") throw new BrandError(sent.message, 409);
        const brand = await resolveSiteBrand({ siteId, organizationId: resolved.organizationId, userId: resolved.userId });
        return {
          success: true,
          state: sent.state,
          message: sent.message,
          changed: sent.changed,
          ...(sent.skipped.length ? { skipped: sent.skipped } : {}),
          ...(brand ? brandForClient(brand) : {}),
          next: sent.state === "waiting" ? "Plexo is keeping the change and will send it to Strata by itself. Tell the owner in one plain line." : "The brand is changed in Strata and the site follows it. Tell the owner in one plain line what changed.",
        };
      }
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (err) {
    if (err instanceof BrandError) throw new Error(err.message);
    throw err;
  }
}
