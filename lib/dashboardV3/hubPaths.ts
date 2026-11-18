/** Where each kind of page is edited (the existing editors). A pure helper shared by server and client code. */
export function editHrefFor(id: string, sourceType: string | null | undefined): string {
  return sourceType === "REACT_PROJECT" ? `/dashboard/apps/${id}` : `/dashboard/templates/${id}`;
}

/** A site's page in the new dashboard: /dashboard/sites/[id], optionally on one tab. */
export function siteHubHref(siteId: string, tab?: string | null): string {
  return tab && tab !== "pages" ? `/dashboard/sites/${siteId}?tab=${tab}` : `/dashboard/sites/${siteId}`;
}

/**
 * Where the OLD per-site "template detail" page (/dashboard/templates/[id]/detail) sends people once they are on
 * the new dashboard. `old` is the old page's own tab name (Preview, Properties, Domain & traffic, Site modules,
 * Deploy/Server app, Variables & secrets). Hosted apps have an App tab; other sites keep deploy tools in Settings.
 */
export function hubTabForOldDetail(old: string | null | undefined, hostedApp: boolean): string {
  switch (old) {
    case "properties":
    case "modules":
      return "settings";
    case "domain":
      return "address";
    case "traffic":
      return "visits";
    case "server":
    case "variables":
      return hostedApp ? "app" : "settings";
    default:
      return hostedApp ? "app" : "pages";
  }
}

/**
 * The one decision behind every "old per-site page -> site hub" redirect. Returns the hub address to send the
 * person to, or null to leave them on the old page: old-dashboard users always stay, and `?classic=1` is the
 * deliberate way in to an old page (e.g. the full file uploader) from a place that has no new equivalent.
 */
export function hubRedirectTarget(opts: { newDashboard: boolean; classic?: string | string[] | null; siteId: string; tab: string }): string | null {
  if (!opts.newDashboard) return null;
  const classic = Array.isArray(opts.classic) ? opts.classic[0] : opts.classic;
  if (classic === "1") return null;
  return siteHubHref(opts.siteId, opts.tab);
}
