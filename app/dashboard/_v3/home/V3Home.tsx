import { cookies } from "next/headers";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";
import { loadV3Sites } from "@/lib/dashboardV3/loadShell";
import { loadSiteFacts, loadSiteStats } from "@/lib/dashboardV3/homeData";
import { readBuildProfile, userExperience } from "@/lib/dashboardV3/profile";
import { CURRENT_SITE_COOKIE, pickCurrentSite } from "@/lib/dashboardV3/sites";
import { computeTasks, taskVariantFor } from "@/lib/dashboardV3/tasks";
import { getPagesDomain } from "@/server/pagesDomain";
import { HomeView } from "./HomeView";
import type { HomeProps, HomeSiteRow } from "./homeTypes";

export const NEW_SITE_HREF = "/welcome/setup?new=1";

type HomeUser = { name?: string | null; experience?: string | null; buildProfile?: unknown; onboardingDeferredAt?: string | null; onboardingVersion?: number | null };

/** Loads what Home needs (real data, each read forgiving) and hands it to the view. */
export async function V3Home({ user, organizationId, userId }: { user: HomeUser; organizationId: string; userId: string }) {
  const experience = userExperience(user);
  const profile: SolBuildProfile | undefined = readBuildProfile(user.buildProfile);
  const firstName = user.name && user.name !== "Plexo User" ? user.name.trim().split(/\s+/)[0] : "there";
  const sites = await loadV3Sites(organizationId, userId).catch(() => []);
  const current = pickCurrentSite(sites, (await cookies()).get(CURRENT_SITE_COOKIE)?.value);
  const brand = { name: profile?.brand?.name, color: profile?.brand?.colors?.[0], logoUrl: profile?.brand?.logoUrl };
  const base: Omit<HomeProps, "mode" | "site" | "all"> = { firstName, experience, brand, baseDomain: getPagesDomain(), newSiteHref: NEW_SITE_HREF };

  if (!current) return <HomeView {...base} mode="none" site={null} all={[]} />;

  const { variant, facts, commerceEnabled } = await loadSiteFacts(current, profile);
  const progress = computeTasks(variant, facts);

  // Pros always see everything together. Intermediate people see everything once the current site is online.
  const wantsAll = experience === "pro" || (experience === "intermediate" && progress.allDone);
  if (wantsAll) {
    const rows: HomeSiteRow[] = await Promise.all(
      sites.slice(0, 24).map(async (s) => ({ site: s, stats: await loadSiteStats(s, s.id === current.id ? variant : taskVariantFor({ kind: s.kind }, profile?.goal)) })),
    );
    return <HomeView {...base} mode="all" site={null} all={rows} />;
  }

  const stats = progress.allDone ? await loadSiteStats(current, variant) : null;
  return <HomeView {...base} mode="site" site={{ site: current, progress, commerceEnabled, stats }} all={[]} />;
}
