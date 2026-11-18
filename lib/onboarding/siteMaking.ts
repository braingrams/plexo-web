/**
 * The two ways a site is made from the owner's answers, shared by onboarding (/api/onboarding/complete) and the
 * dashboard's "Make a new website" (/api/dashboard/new-site) so there is one implementation of each:
 *  - from the site kit (site_create), and
 *  - from a real marketplace design (the marketplace's own "use" path, which re-checks it is free or owned and
 *    enforces the plan's limits; never trusted from the browser).
 * Either way the owner's logo and colours are saved on the new site's Brand tab.
 */
import { Template } from "@/lib/db/contentEntities";
import type { resolveUser } from "@/lib/auth/resolveUser";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";
import { siteBrandFromProfile } from "@/lib/dashboardV3/brandLook";
import { handleSiteTool } from "@/lib/mcp/siteTools";
import { useMarketplaceTemplate } from "@/lib/marketplaceUse";

type Resolved = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

async function saveBrandOnSite(siteId: string, brand: SolBuildProfile["brand"] | undefined): Promise<void> {
  const own = siteBrandFromProfile(brand);
  if (own) await Template.patch({ id: siteId }).set({ brand: own }).go().catch((e) => console.error("copying brand onto the new site failed", e));
}

export async function makeSiteFromKit(resolved: Resolved, args: Record<string, unknown>, brand: SolBuildProfile["brand"] | undefined): Promise<{ siteId: string; name: string; warnings?: string[] }> {
  const made = await handleSiteTool("site_create", args, resolved);
  await saveBrandOnSite(made.siteId, brand);
  return { siteId: made.siteId, name: made.name, warnings: made.warnings };
}

export async function makeSiteFromMarketDesign(resolved: Resolved, designId: string, name: string, brand: SolBuildProfile["brand"] | undefined): Promise<{ siteId: string; name: string }> {
  const made = await useMarketplaceTemplate(resolved, designId, { name });
  // The design itself is left exactly as its maker built it; the owner's logo and colours go on the Brand tab.
  await saveBrandOnSite(made.id, brand);
  return { siteId: made.id, name: made.name };
}
