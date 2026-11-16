import { cookies } from "next/headers";
import { Template, PublishedDomain } from "@/lib/db/contentEntities";
import { buildV3Nav, type Experience, type V3NavItem } from "./nav";
import { readBuildProfile, userExperience } from "./profile";
import { CURRENT_SITE_COOKIE, pickCurrentSite, siteKindOf, type SiteSummary } from "./sites";
import { resolveThemePreference, THEME_COOKIE, type ThemePreference } from "./theme";
import { readTourState, type TourState } from "./tour";

export type V3ShellData = {
  experience: Experience;
  nav: V3NavItem[];
  sites: SiteSummary[];
  currentSite: SiteSummary | null;
  themePreference: ThemePreference;
  tourState: TourState;
};

type ShellUser = {
  id: string;
  experience?: string | null;
  buildProfile?: unknown;
  themePreference?: string | null;
  tourState?: unknown;
};

/** The organisation's sites (root landing pages and apps), lightest possible read. */
export async function loadV3Sites(organizationId: string, userId: string): Promise<SiteSummary[]> {
  const [{ data: templates }, { data: domains }] = await Promise.all([
    Template.query
      .byOrg({ organizationId })
      .go({
        pages: "all",
        attributes: ["id", "name", "kind", "parentId", "marketplaceStatus", "isBlogLayout", "isSiteLayoutFragment", "isCommerceLayout", "isLmsPageDesign", "isLmsFunnel", "sourceType", "updatedAt"],
      }),
    PublishedDomain.query.byUser({ userId }).go({ pages: "all", attributes: ["templateId", "domain", "type", "active", "organizationId"] }),
  ]);
  const roots = templates.filter((t) => t.kind === "LANDING_PAGE" && !t.parentId && !t.marketplaceStatus && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout && !t.isLmsPageDesign);
  const live = new Map<string, string>();
  for (const d of domains) {
    if (d.active === false || d.organizationId !== organizationId) continue;
    // Prefer showing their own web address over the free plexopages one.
    if (!live.has(d.templateId) || d.type === "CUSTOM") live.set(d.templateId, d.domain);
  }
  return roots
    .map((t) => ({
      id: t.id,
      name: t.name || "Untitled site",
      kind: siteKindOf({ sourceType: t.sourceType, isLmsFunnel: t.isLmsFunnel }),
      status: live.has(t.id) ? ("live" as const) : ("draft" as const),
      address: live.get(t.id) ?? null,
      updatedAt: t.updatedAt ?? null,
    }))
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function loadV3ShellData(user: ShellUser, organizationId: string): Promise<V3ShellData> {
  const jar = await cookies();
  const experience = userExperience(user);
  const goal = readBuildProfile(user.buildProfile)?.goal ?? null;
  const sites = await loadV3Sites(organizationId, user.id).catch((err) => {
    console.error("v3 shell: loading sites failed", err);
    return [] as SiteSummary[];
  });
  const currentSite = pickCurrentSite(sites, jar.get(CURRENT_SITE_COOKIE)?.value);
  return {
    experience,
    nav: buildV3Nav({ experience, goal, siteCount: sites.length, sells: sites.some((s) => s.kind === "Online store"), teaches: sites.some((s) => s.kind === "Course") }),
    sites,
    currentSite,
    themePreference: resolveThemePreference({ user: user.themePreference, cookie: jar.get(THEME_COOKIE)?.value }),
    tourState: readTourState(user.tourState),
  };
}

/** For pages outside the dashboard (onboarding) that only need the theme. */
export async function readThemePreference(userPreference?: string | null): Promise<ThemePreference> {
  const jar = await cookies();
  return resolveThemePreference({ user: userPreference, cookie: jar.get(THEME_COOKIE)?.value });
}
