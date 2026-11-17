import type { DesignSystem } from "@charisol/plexo-sdk/v2/compile";
import { Template } from "@/lib/db/contentEntities";
import { SiteBrand, User } from "@/lib/db/coreEntities";
import { readSiteBrand } from "@/lib/dashboardV3/brandLook";
import { readBuildProfile } from "@/lib/dashboardV3/profile";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";
import { brandStore } from "./store";
import { mergeBrand, type LinkedBrandInput, type ResolvedBrand } from "./brandModel";

// THE server-side brand resolver. Everything that needs "what is this site's brand?" asks here: the dashboard's Brand tab and
// Home card, SOL's context, SOL's quality gate, the MCP tools, email building and the app design tools. The precedence rule
// lives in brandModel.ts (linked Strata project > the site's own saved brand > the account's onboarding brand > nothing).
//
// No Next.js imports: SOL's standalone Lambda bundle uses this.

type LinkRow = NonNullable<Awaited<ReturnType<ReturnType<typeof SiteBrand.get>["go"]>>["data"]>;
type SiteRow = { id: string; name?: string | null; organizationId: string; sourceType?: string | null; brand?: unknown; parentId?: string | null };

// A linked site's design system is read from storage; its revision changes on every sync, so it is a perfect cache key.
const dsMemo = new Map<string, DesignSystem | null>();
async function linkedDesign(site: SiteRow, link: LinkRow): Promise<DesignSystem | null> {
  const key = `${site.id}:${link.revision ?? ""}`;
  if (dsMemo.has(key)) return dsMemo.get(key) ?? null;
  let ds: DesignSystem | null = null;
  try {
    if (site.sourceType === "REACT_PROJECT") {
      const { listDesigns } = await import("@/lib/projects/designs");
      ds = (await listDesigns(site.id)).designSystem ?? null;
    } else ds = await brandStore().getDesignSystem(site.id);
  } catch (err) {
    console.warn(`[site-brand] ${site.id}: couldn't read the linked brand`, err);
  }
  dsMemo.set(key, ds);
  if (dsMemo.size > 200) dsMemo.delete(dsMemo.keys().next().value!);
  return ds;
}

/** A visual-editor site's own design system (its root page's), for the fonts it was built with. Best effort. */
async function ownDesignSystem(site: SiteRow): Promise<DesignSystem | null> {
  if (site.sourceType === "REACT_PROJECT" || site.sourceType === "RAW_UPLOAD") return null;
  try {
    const { data } = await Template.get({ id: site.id }).go({ attributes: ["designJson", "draftJson", "designFormat"] });
    if (!data || data.designFormat !== "v2") return null;
    const { resolveDesignSystem } = await import("@/lib/v2/designSystemStore");
    const raw = (await resolveDesignSystem((data.draftJson ?? data.designJson) as never)) as { designSystem?: DesignSystem } | null;
    return raw?.designSystem && Array.isArray(raw.designSystem.tokens) ? raw.designSystem : null;
  } catch {
    return null;
  }
}

function linkedInput(site: SiteRow, link: LinkRow, ds: DesignSystem | null): LinkedBrandInput {
  return {
    projectId: link.strataProjectId,
    projectName: link.projectName ?? null,
    syncOn: link.autoSync !== false,
    status: link.status,
    designSystem: ds,
    logoUrl: link.projectLogo ?? null,
    stylesheet: link.revision ? `/__plexo/brand/${site.id}.css` : null,
  };
}

/** The account's onboarding brand (the lowest rung before "nothing"). */
export async function loadProfileBrand(userId: string | undefined): Promise<SolBuildProfile["brand"] | undefined> {
  if (!userId) return undefined;
  try {
    const { data } = await User.get({ id: userId }).go({ attributes: ["buildProfile"] });
    return readBuildProfile(data?.buildProfile)?.brand;
  } catch {
    return undefined;
  }
}

async function resolveRow(site: SiteRow, link: LinkRow | null | undefined, profile: SolBuildProfile["brand"] | undefined, withOwnDesign: boolean): Promise<ResolvedBrand> {
  const ds = link ? await linkedDesign(site, link) : null;
  const ownDesign = !link && withOwnDesign ? await ownDesignSystem(site) : null;
  return mergeBrand({
    siteId: site.id,
    siteName: site.name ?? undefined,
    linked: link ? linkedInput(site, link, ds) : null,
    own: readSiteBrand(site.brand),
    profile,
    ownDesign,
  });
}

/**
 * One site's brand. `organizationId` (when given) must match the site's: a site of another workspace is never resolved.
 * Returns null when the site doesn't exist (or isn't the caller's).
 */
export async function resolveSiteBrand(input: { siteId: string; organizationId?: string; userId?: string; profile?: SolBuildProfile["brand"] }): Promise<ResolvedBrand | null> {
  const { data: site } = await Template.get({ id: input.siteId }).go({ attributes: ["id", "name", "organizationId", "sourceType", "brand", "parentId"] });
  if (!site || site.parentId || (input.organizationId && site.organizationId !== input.organizationId)) return null;
  const [{ data: link }, profile] = await Promise.all([SiteBrand.get({ siteId: site.id }).go(), input.profile !== undefined ? Promise.resolve(input.profile) : loadProfileBrand(input.userId)]);
  return resolveRow(site, link, profile, true);
}

/**
 * Many sites at once (SOL's context): one batched read of the link rows, the linked brands read from storage (cached).
 * `limit` bounds the storage reads for owners with a great many linked sites; the rest still resolve from their saved brand.
 */
export async function resolveBrandsForSites(sites: SiteRow[], profile: SolBuildProfile["brand"] | undefined, limit = 12): Promise<Map<string, ResolvedBrand>> {
  const out = new Map<string, ResolvedBrand>();
  if (!sites.length) return out;
  let links = new Map<string, LinkRow>();
  try {
    const got = await SiteBrand.get(sites.map((s) => ({ siteId: s.id }))).go();
    links = new Map((got.data as LinkRow[]).map((l) => [l.siteId, l]));
  } catch (err) {
    console.warn("[site-brand] couldn't read the linked brands", err);
  }
  let reads = 0;
  for (const s of sites) {
    const link = links.get(s.id) ?? null;
    if (link && reads >= limit) {
      out.set(s.id, mergeBrand({ siteId: s.id, siteName: s.name ?? undefined, linked: linkedInput(s, link, null), own: readSiteBrand(s.brand), profile }));
      continue;
    }
    if (link) reads++;
    out.set(s.id, await resolveRow(s, link, profile, false));
  }
  return out;
}

/** The brand for a site, or null — for callers that must never fail because of a brand (emails, tool defaults). */
export async function tryResolveSiteBrand(input: { siteId?: string | null; organizationId?: string; userId?: string }): Promise<ResolvedBrand | null> {
  if (!input.siteId) return null;
  try {
    return await resolveSiteBrand({ siteId: input.siteId, organizationId: input.organizationId, userId: input.userId });
  } catch (err) {
    console.warn(`[site-brand] ${input.siteId}: couldn't resolve the brand`, err);
    return null;
  }
}

/** The site (root page id) a page belongs to, so a brand asked for with a sub-page's id resolves for the whole site. */
export async function siteIdOfPage(templateId: string): Promise<string> {
  try {
    const { data } = await Template.get({ id: templateId }).go({ attributes: ["id", "parentId"] });
    let cur = data;
    for (let i = 0; i < 6 && cur?.parentId; i++) cur = (await Template.get({ id: cur.parentId }).go({ attributes: ["id", "parentId"] })).data;
    return cur?.id ?? templateId;
  } catch {
    return templateId;
  }
}
