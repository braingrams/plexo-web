import { cookies } from "next/headers";
import { loadV3Sites } from "@/lib/dashboardV3/loadShell";
import { CURRENT_SITE_COOKIE, pickCurrentSite } from "@/lib/dashboardV3/sites";
import { loadSiteStats } from "@/lib/dashboardV3/homeData";
import { taskVariantFor } from "@/lib/dashboardV3/tasks";
import { requireHubContext } from "@/lib/dashboardV3/hubData";
import { ALL_SITES_PATH } from "@/lib/dashboardV3/allSites";
import { AllSitesBoard, type BoardSite } from "../../_v3/hub/AllSitesBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "All my sites" };

/** Every site at once, a calm board with each site's picture and quick actions (the simple view's "Show all my sites at once"). */
export default async function AllSitesPage() {
  const ctx = await requireHubContext(ALL_SITES_PATH);
  const sites = await loadV3Sites(ctx.organizationId, ctx.userId);
  // The 24 most recently edited also load their numbers, which keeps the page quick for people with many sites.
  const rows: BoardSite[] = await Promise.all(
    sites.map(async (site, i) => ({
      site,
      stats: i < 24 ? (await loadSiteStats(site, taskVariantFor({ kind: site.kind })).catch(() => null))?.stats ?? [] : [],
    })),
  );
  const jar = await cookies();
  const current = pickCurrentSite(sites, jar.get(CURRENT_SITE_COOKIE)?.value);
  return <AllSitesBoard rows={rows} homeName={current?.name ?? null} />;
}
