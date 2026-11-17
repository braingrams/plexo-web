import { redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { usesNewShell } from "../dashboardVersions/state";
import { hubRedirectTarget } from "./hubPaths";
import { oldListRedirect, type SiteFilter } from "./siteFilter";

/** Whether the signed-in person is on the new dashboard (the same check the layout and the settings redirects use). */
export async function currentUserOnNewDashboard(userId?: string): Promise<boolean> {
  const id = userId ?? (await auth())?.user?.id;
  if (!id) return false;
  const { data: user } = await User.get({ id }).go();
  return usesNewShell(user);
}

/**
 * Old per-site pages: when the new dashboard is on, send people to the matching tab of the site hub instead.
 * Old-dashboard users, and `?classic=1`, fall through and the old page renders unchanged.
 */
export async function redirectToHubIfV3(siteId: string, tab: string, classic?: string | string[] | null, userId?: string): Promise<void> {
  const to = hubRedirectTarget({ newDashboard: await currentUserOnNewDashboard(userId), classic, siteId, tab });
  if (to) redirect(to);
}

/** Old list pages: when the new dashboard is on, send people to the Sites list with the matching filter. */
export async function redirectToSitesIfV3(filter: SiteFilter, classic?: string | string[] | null): Promise<void> {
  const to = oldListRedirect({ newDashboard: await currentUserOnNewDashboard(), classic, filter });
  if (to) redirect(to);
}
