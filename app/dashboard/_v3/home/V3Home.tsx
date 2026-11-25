import { JUST_MADE_COOKIE, NEW_SITE_PATH } from "@/lib/dashboardV3/newSite";
import { cookies } from "next/headers";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";
import { loadV3Sites } from "@/lib/dashboardV3/loadShell";
import { loadSiteFacts, loadSiteStats } from "@/lib/dashboardV3/homeData";
import { readBuildProfile, userExperience } from "@/lib/dashboardV3/profile";
import { CURRENT_SITE_COOKIE } from "@/lib/dashboardV3/sites";
import { homeEntry, homeMode } from "@/lib/dashboardV3/homeMode";
import { RememberSite } from "./RememberSite";
import { ButtonLink, Card } from "../ui";
import { displayBrand, type SiteBrand } from "@/lib/dashboardV3/brandLook";
import { resolveSiteBrand } from "@/lib/brand/resolveSiteBrand";
import { computeTasks, taskVariantFor } from "@/lib/dashboardV3/tasks";
import { CURRENT_ONBOARDING_VERSION } from "@/lib/dashboardV3/flag";
import { getPagesDomain } from "@/server/pagesDomain";
import { loadHubPages, loadHubSite } from "@/lib/dashboardV3/hubData";
import { HomeView } from "./HomeView";
import type { HomeProps, HomeSiteRow } from "./homeTypes";

export const NEW_SITE_HREF = NEW_SITE_PATH;

type HomeUser = { name?: string | null; experience?: string | null; buildProfile?: unknown; onboardingDeferredAt?: string | null; onboardingVersion?: number | null };

/** Loads what Home needs (real data, each read forgiving) and hands it to the view. */
export async function V3Home({ user, organizationId, userId }: { user: HomeUser; organizationId: string; userId: string }) {
  const experience = userExperience(user);
  const profile: SolBuildProfile | undefined = readBuildProfile(user.buildProfile);
  const firstName = user.name && user.name !== "Plexo User" ? user.name.trim().split(/\s+/)[0] : "there";
  // A failed read is NOT "no sites": never show someone with many sites the "set up your first site" screen.
  let sites: Awaited<ReturnType<typeof loadV3Sites>>;
  try {
    sites = await loadV3Sites(organizationId, userId);
  } catch (err) {
    console.error("v3 home: loading sites failed", err);
    return (
      <div className="plx-page">
        <Card tone="tint" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
          <span className="plx-h2">We couldn&apos;t load your websites just now</span>
          <span className="plx-body">Nothing is lost. Please try again in a moment.</span>
          <ButtonLink href="/dashboard" variant="strong">Try again</ButtonLink>
        </Card>
      </div>
    );
  }
  // The site they last picked if it still exists, else the most recently edited one (and the cookie gets repaired).
  const jar = await cookies();
  const { current, fixCookieTo } = homeEntry(sites, jar.get(CURRENT_SITE_COOKIE)?.value);
  const brandOf = (s: { brand?: SiteBrand }) => {
    const b = displayBrand(s.brand, profile?.brand);
    return { name: profile?.brand?.name, color: b.colors?.[0], logoUrl: b.logoUrl };
  };
  let brand = current ? brandOf(current) : brandOf({});
  // The brand the site REALLY uses (a linked Strata project beats the site's saved colours, which beat the account's): lib/brand/resolveSiteBrand.ts.
  if (current) {
    const resolved = await resolveSiteBrand({ siteId: current.id, organizationId, userId, profile: profile?.brand }).catch(() => null);
    if (resolved && (resolved.colours.length || resolved.logoUrl)) brand = { name: profile?.brand?.name, color: resolved.colours[0]?.value ?? brand.color, logoUrl: resolved.logoUrl ?? brand.logoUrl };
  }
  // Someone with sites who hasn't done the short "tune Plexo to you" setup gets a card for it (never "set up your first site").
  const tuneHref = sites.length > 0 && (user.onboardingVersion ?? 0) < CURRENT_ONBOARDING_VERSION ? "/welcome/setup" : undefined;
  const base: Omit<HomeProps, "mode" | "site" | "all"> = { firstName, experience, brand, siteCount: sites.length, baseDomain: getPagesDomain(), newSiteHref: NEW_SITE_HREF, tuneHref };

  if (!current) return <HomeView {...base} mode="none" site={null} all={[]} />;
  const remember = fixCookieTo ? <RememberSite siteId={fixCookieTo} /> : null;

  const { variant, facts, commerceEnabled } = await loadSiteFacts(current, profile);
  const progress = computeTasks(variant, facts);

  // Pros always see everything together. Intermediate people see everything once the current site is online.
  const mode = homeMode({ siteCount: sites.length, experience, currentAllDone: progress.allDone, justMade: jar.get(JUST_MADE_COOKIE)?.value === current.id });
  if (mode === "all") {
    // Every site is listed; the first 24 (most recently edited) also load their numbers, which keeps the page quick.
    const rows: HomeSiteRow[] = await Promise.all(
      sites.map(async (s, i) => ({
        site: s,
        stats: i < 24 ? await loadSiteStats(s, s.id === current.id ? variant : taskVariantFor({ kind: s.kind }, profile?.goal)) : { stats: [], activity: [], activityTitle: "", activityEmpty: "" },
      })),
    );
    return (<>{remember}<HomeView {...base} mode="all" site={null} all={rows} /></>);
  }

  const stats = progress.allDone ? await loadSiteStats(current, variant) : null;
  // "Add more to your site" needs what this site already has; a failed read just hides that area.
  const addMore = await Promise.all([loadHubSite(organizationId, current.id), loadHubPages(organizationId, current.id)])
    .then(([hub, pages]) => ({ features: hub.features, pages: pages.map((p) => ({ name: p.name, path: p.path })) }))
    .catch(() => undefined);
  return (<>{remember}<HomeView {...base} mode="site" site={{ site: current, progress, commerceEnabled, stats, addMore }} all={[]} /></>);
}
