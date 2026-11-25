/**
 * "Use this design": saves the owner's answers and builds their site with the same tool SOL
 * and MCP clients use (site_create, lib/mcp/siteTools.ts) so there is one way to make a site.
 * Pure parts (what to call site_create with) are separate from the doing, so both are tested.
 */
import { detectIndustry, suggestSitePages } from "@charisol/plexo-sdk/v2/compile";
import type { SolBuildGoal, SolBuildProfile } from "@/lib/ai/solBuildContext";
import { sanitizeBuildProfile } from "@/lib/dashboardV3/profile";
import { CURRENT_ONBOARDING_VERSION } from "@/lib/dashboardV3/flag";
import { briefFromProfile, pageTypeForGoal, rankDesigns } from "./designs";

export type SiteCreateGoal = "store" | "business-site" | "blog" | "course" | "landing" | "link-in-bio";

/** Goal → site_create's goal. Store turns Commerce on (Plexo payments), blog the blog; "looking around" gets a business site to explore. */
export function siteGoalFor(goal: SolBuildGoal | undefined): SiteCreateGoal | null {
  switch (goal) {
    case "store": case "business-site": case "blog": case "course": case "landing": case "link-in-bio": return goal;
    case "explore": return "business-site";
    default: return null; // an app is built with Sol, not from a design
  }
}

/** The arguments for site_create. The chosen design becomes the layout of the home (or one-page) page. */
export function siteCreateArgs(p: SolBuildProfile, designId: string): Record<string, unknown> | null {
  const goal = siteGoalFor(p.goal);
  if (!goal) return null;
  const brief = briefFromProfile(p);
  const leadType = pageTypeForGoal(p.goal);
  const valid = rankDesigns(p).some((r) => r.id === designId);
  const pages = suggestSitePages(goal, brief).map((type) => (type === leadType && valid ? { type, layout: designId } : { type }));
  return { brief, goal, pages };
}

export class OnboardingError extends Error {}

export type CompleteDeps = {
  /** Saves fields on the user. */
  saveUser: (patch: { buildProfile: SolBuildProfile; experience?: string; onboardingVersion?: number }) => Promise<void>;
  /** Runs site_create; returns what it made. */
  createSite: (args: Record<string, unknown>) => Promise<{ siteId: string; name: string; warnings?: string[] }>;
  /** Makes the site from a real marketplace design (free or already bought), named after the business. */
  createFromMarketDesign?: (designId: string, name: string) => Promise<{ siteId: string; name: string; warnings?: string[] }>;
};

export type CompleteResult = { site: { id: string; name: string; goal: SolBuildGoal } | null; warnings: string[] };

/**
 * Saves buildProfile + experience, builds the site (unless they skipped, or chose an app), then
 * marks onboarding finished. The finish flag is written last, so a failed build lets them retry.
 */
export async function completeOnboarding(input: { profile: unknown; designId?: string; marketDesignId?: string; skipSite?: boolean }, deps: CompleteDeps): Promise<CompleteResult> {
  const parsed = sanitizeBuildProfile(input.profile);
  if (!parsed.ok) throw new OnboardingError(parsed.error);
  const profile = parsed.value;
  if (!profile.brand?.name) throw new OnboardingError("Add your business name first, so we can put it on your site.");
  const brand = profile.brand;
  profile.brand = { ...brand, industry: brand.industry ?? detectIndustry({ about: brand.about, name: brand.name }) };

  const wantsSite = !input.skipSite && siteGoalFor(profile.goal) !== null;
  await deps.saveUser({ buildProfile: profile, ...(profile.experience ? { experience: profile.experience } : {}) });

  let site: CompleteResult["site"] = null;
  let warnings: string[] = [];
  if (wantsSite) {
    if (input.marketDesignId && deps.createFromMarketDesign) {
      const made = await deps.createFromMarketDesign(input.marketDesignId, profile.brand.name!);
      site = { id: made.siteId, name: made.name, goal: profile.goal! };
      warnings = made.warnings ?? [];
    } else {
      const args = siteCreateArgs(profile, input.designId ?? "");
      if (!args) throw new OnboardingError("Pick what you'd like to make first.");
      const made = await deps.createSite(args);
      site = { id: made.siteId, name: made.name, goal: profile.goal! };
      warnings = made.warnings ?? [];
    }
  }
  await deps.saveUser({ buildProfile: profile, onboardingVersion: CURRENT_ONBOARDING_VERSION });
  return { site, warnings };
}
