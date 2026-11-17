import { cookies } from "next/headers";
import { Template, PublishedDomain } from "@/lib/db/contentEntities";
import { buildV3Nav, type Experience, type V3NavItem } from "./nav";
import { readBuildProfile, userExperience } from "./profile";
import { CURRENT_SITE_COOKIE, pickCurrentSite, type SiteSummary } from "./sites";
import { summarizeSites } from "./siteList";
import { resolveThemePreference, THEME_COOKIE, type ThemePreference } from "./theme";
import { membershipsForUser } from "@/server/orgMemberships";
import { readTourState, type TourState } from "./tour";

export type V3ShellData = {
  experience: Experience;
  nav: V3NavItem[];
  sites: SiteSummary[];
  currentSite: SiteSummary | null;
  themePreference: ThemePreference;
  tourState: TourState;
  workspaces: { id: string; name: string; role: string }[];
};

type ShellUser = {
  id: string;
  experience?: string | null;
  buildProfile?: unknown;
  themePreference?: string | null;
  tourState?: unknown;
};

const SITE_ATTRIBUTES = ["id", "name", "kind", "parentId", "marketplaceStatus", "isBlogLayout", "isSiteLayoutFragment", "isCommerceLayout", "isLmsPageDesign", "isLmsFunnel", "sourceType", "migratedFrom", "updatedAt", "brand"] as const;

/**
 * Every site in the workspace (builder pages, uploaded pages, moved WordPress sites, apps,
 * funnels), lightest possible read. Two things used to make a person with many sites look like
 * they had none: the web-address lookup failing took the whole list down with it (the caller
 * swallowed the error), and a workspace whose sites sit under a different workspace id showed
 * empty. Now the address lookup is forgiving on its own, and an empty workspace falls back to
 * the sites the person owns.
 */
export async function loadV3Sites(organizationId: string, userId: string): Promise<SiteSummary[]> {
  const [{ data: templates }, domains] = await Promise.all([
    Template.query.byOrg({ organizationId }).go({ pages: "all", attributes: [...SITE_ATTRIBUTES] }),
    PublishedDomain.query
      .byUser({ userId })
      .go({ pages: "all", attributes: ["templateId", "domain", "type", "active", "organizationId"] })
      .then((r) => r.data)
      .catch((err) => {
        console.error("v3 sites: web addresses failed to load", err);
        return [];
      }),
  ]);
  const inWorkspace = summarizeSites(templates, domains, organizationId);
  if (inWorkspace.length) return inWorkspace;
  const owned = await Template.query
    .byUser({ userId })
    .go({ pages: "all", attributes: [...SITE_ATTRIBUTES] })
    .then((r) => r.data)
    .catch((err) => {
      console.error("v3 sites: owned-sites lookup failed", err);
      return [];
    });
  return summarizeSites(owned, domains);
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
  const workspaces = await membershipsForUser(user.id)
    .then((ms) => ms.map((m) => ({ id: m.organizationId, name: m.organization.name, role: m.role as string })))
    .catch((err) => {
      // The workspace switcher only shows with 2+ workspaces, so a failed lookup would hide it without a trace: say so in the log.
      console.error("v3 shell: loading workspaces failed (the workspace switcher will be hidden)", err);
      return [];
    });
  return {
    workspaces,
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
