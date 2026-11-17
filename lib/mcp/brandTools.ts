import type { resolveUser } from "@/lib/auth/resolveUser";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { Template } from "@/lib/db/contentEntities";
import { brandForClient } from "@/lib/brand/brandModel";
import { resolveSiteBrand, siteIdOfPage } from "@/lib/brand/resolveSiteBrand";
import { BrandError, createStrataProjectFromSiteBrand, getSiteBrandState, linkSiteBrand, listOwnerStrataProjects } from "@/lib/brand/siteBrand";

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
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (err) {
    if (err instanceof BrandError) throw new Error(err.message);
    throw err;
  }
}
