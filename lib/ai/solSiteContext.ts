import type { SolBuildProfile } from "@/lib/ai/solBuildContext";
import type { SiteSignal } from "@/lib/ai/solSiteResolution";

/**
 * Adds ALL of the owner's sites (name, edit time, own logo and colours) and which one was chosen to the profile
 * SOL works from. Which site a request is about is decided by lib/ai/solSiteResolution.ts, never by "the latest
 * one". Never throws: without it SOL works from the account's onboarding answers and asks which site if needed.
 */
export async function withSites(profile: SolBuildProfile | undefined, organizationId: string, signal: SiteSignal): Promise<SolBuildProfile | undefined> {
  try {
    const [{ Template }, { readSiteBrand }] = await Promise.all([import("@/lib/db/contentEntities"), import("@/lib/dashboardV3/brandLook")]);
    const { data } = await Template.query.byOrg({ organizationId }).go({ pages: "all", attributes: ["id", "name", "kind", "parentId", "updatedAt", "brand", "isBlogLayout", "isSiteLayoutFragment", "isCommerceLayout", "isLmsPageDesign"] });
    const sites = data
      .filter((t) => !t.parentId && t.kind === "LANDING_PAGE" && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout && !t.isLmsPageDesign)
      .map((t) => ({ id: t.id, name: t.name || undefined, updatedAt: t.updatedAt, brand: readSiteBrand(t.brand) }));
    return { ...(profile ?? {}), sites, siteSignal: signal };
  } catch (err) {
    console.error("withSites failed", err);
    return profile;
  }
}
