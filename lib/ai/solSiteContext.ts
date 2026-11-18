import type { SolBuildProfile } from "@/lib/ai/solBuildContext";
import type { SiteSignal } from "@/lib/ai/solSiteResolution";

/**
 * Adds ALL of the owner's sites (name, edit time, own logo and colours) and which one was chosen to the profile
 * SOL works from. Which site a request is about is decided by lib/ai/solSiteResolution.ts, never by "the latest
 * one". Never throws: without it SOL works from the account's onboarding answers and asks which site if needed.
 */
export async function withSites(profile: SolBuildProfile | undefined, organizationId: string, signal: SiteSignal): Promise<SolBuildProfile | undefined> {
  try {
    const [{ Template }, { readSiteBrand }, { resolveBrandsForSites }, { knownBrandFromResolved }] = await Promise.all([
      import("@/lib/db/contentEntities"),
      import("@/lib/dashboardV3/brandLook"),
      import("@/lib/brand/resolveSiteBrand"),
      import("@/lib/brand/brandModel"),
    ]);
    const { data } = await Template.query.byOrg({ organizationId }).go({ pages: "all", attributes: ["id", "name", "kind", "parentId", "updatedAt", "brand", "sourceType", "organizationId", "isBlogLayout", "isSiteLayoutFragment", "isCommerceLayout", "isLmsPageDesign"] });
    const rows = data.filter((t) => !t.parentId && t.kind === "LANDING_PAGE" && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout && !t.isLmsPageDesign);
    // ONE resolver (lib/brand/resolveSiteBrand.ts) decides each site's brand: linked Strata project > the site's own > the account's.
    // Whatever it finds from the first two is what SOL treats as THIS site's brand (the account's stays the separate "account" input),
    // so a brand changed in Strata reaches the very next turn, and no site's brand ever leaks into another.
    const brands = await resolveBrandsForSites(rows.map((t) => ({ id: t.id, name: t.name, organizationId: t.organizationId, sourceType: t.sourceType, brand: t.brand })), profile?.brand).catch(() => new Map());
    const sites = rows.map((t) => {
      const resolved = brands.get(t.id);
      const ownsBrand = resolved && (resolved.source === "strata" || resolved.source === "site");
      const own = readSiteBrand(t.brand);
      return {
        id: t.id,
        name: t.name || undefined,
        updatedAt: t.updatedAt,
        brand: ownsBrand ? { ...(own ?? {}), ...knownBrandFromResolved(resolved) } : own,
        ...(ownsBrand ? { resolvedBrand: resolved } : {}),
      };
    });
    return { ...(profile ?? {}), sites, siteSignal: signal };
  } catch (err) {
    console.error("withSites failed", err);
    return profile;
  }
}
