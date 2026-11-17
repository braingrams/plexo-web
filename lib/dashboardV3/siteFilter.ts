/** The filter on the new Sites list: everything, only websites, or only apps. */
export type SiteFilter = "all" | "websites" | "apps";

export const SITE_FILTERS: { value: SiteFilter; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "websites", label: "Websites" },
  { value: "apps", label: "Apps" },
];

/** Reads the `?show=` query; anything unknown means "everything". */
export function parseSiteFilter(raw: string | string[] | null | undefined): SiteFilter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "websites" || v === "apps" ? v : "all";
}

/** Kinds that are apps rather than websites (matches the labels in lib/dashboardV3/sites.ts). */
export function isAppKind(kind: string): boolean {
  return kind === "App with sign-in" || kind === "Server app" || kind === "Uploaded app";
}

export function filterSites<T extends { app: boolean }>(sites: T[], filter: SiteFilter): T[] {
  if (filter === "apps") return sites.filter((s) => s.app);
  if (filter === "websites") return sites.filter((s) => !s.app);
  return sites;
}

export function sitesListHref(filter: SiteFilter): string {
  return filter === "all" ? "/dashboard/sites" : `/dashboard/sites?show=${filter}`;
}

/**
 * Old list pages (Templates, Pages, Apps): where new-dashboard users go instead, or null to stay.
 * Old-dashboard users and `?classic=1` stay on the old page.
 */
export function oldListRedirect(opts: { newDashboard: boolean; classic?: string | string[] | null; filter: SiteFilter }): string | null {
  if (!opts.newDashboard) return null;
  const classic = Array.isArray(opts.classic) ? opts.classic[0] : opts.classic;
  if (classic === "1") return null;
  return sitesListHref(opts.filter);
}
