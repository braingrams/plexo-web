import type { SolBuildProfile } from "@/lib/ai/solBuildContext";

/**
 * Adds the owner's most recently edited site (its name and its own logo and colours) to the profile SOL
 * works from, so the intake never asks for what the site already holds. Never throws: without it SOL just
 * uses the account's onboarding answers.
 */
export async function withCurrentSite(profile: SolBuildProfile | undefined, organizationId: string): Promise<SolBuildProfile | undefined> {
  try {
    const [{ Template }, { readSiteBrand }] = await Promise.all([import("@/lib/db/contentEntities"), import("@/lib/dashboardV3/brandLook")]);
    const { data } = await Template.query.byOrg({ organizationId }).go({ pages: "all", attributes: ["id", "name", "kind", "parentId", "updatedAt", "brand", "isBlogLayout", "isSiteLayoutFragment", "isCommerceLayout", "isLmsPageDesign"] });
    const sites = data.filter((t) => !t.parentId && t.kind === "LANDING_PAGE" && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout && !t.isLmsPageDesign);
    const latest = [...sites].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
    if (!latest) return profile;
    return { ...(profile ?? {}), currentSite: { id: latest.id, name: latest.name || undefined, brand: readSiteBrand(latest.brand) } };
  } catch (err) {
    console.error("withCurrentSite failed", err);
    return profile;
  }
}
