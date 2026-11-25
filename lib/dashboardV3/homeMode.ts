/**
 * Which Home a person sees, decided only by the sites they really have (pure). The setup/onboarding state never
 * decides it: someone who skipped setup but has sites still gets their sites; the "no site yet" screen is only for
 * people with none.
 */
import type { Experience } from "./nav";
import { pickCurrentSite, type SiteSummary } from "./sites";

export type HomeMode = "none" | "site" | "all";

export type HomeEntry = {
  current: SiteSummary | null;
  /** The cookie should be (re)written to this id: it was missing, or pointed at a site that no longer exists. */
  fixCookieTo: string | null;
};

/** The current site (cookie if it still exists, else the most recently edited) and whether the cookie needs repair. */
export function homeEntry(sites: SiteSummary[], cookieValue?: string | null): HomeEntry {
  const current = pickCurrentSite(sites, cookieValue);
  if (!current) return { current: null, fixCookieTo: null };
  return { current, fixCookieTo: cookieValue === current.id ? null : current.id };
}

/**
 * "none": no sites at all. "all": the dense everything-together Home (pros with any sites, and intermediate people
 * once the current site is online). "site": the guided steps, then that site's dashboard. A site just made always opens on its steps.
 */
export function homeMode(input: { siteCount: number; experience: Experience; currentAllDone: boolean; /** The current site is the one made a moment ago ("Make a new website" sets a cookie): its steps come first for everyone, pros included, until it is online. */ justMade?: boolean }): HomeMode {
  if (input.siteCount <= 0) return "none";
  if (input.justMade && !input.currentAllDone) return "site";
  if (input.experience === "pro") return "all";
  if (input.experience === "intermediate" && input.currentAllDone) return "all";
  return "site";
}
