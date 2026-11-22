import { cookies } from "next/headers";
import { loadHubSiteCards, requireHubContext } from "@/lib/dashboardV3/hubData";
import { parseSiteFilter } from "@/lib/dashboardV3/siteFilter";
import { SitesList } from "../_v3/hub/SitesList";
import { AllSitesBoard, type BoardSite } from "../_v3/hub/AllSitesBoard";
import { loadV3Sites } from "@/lib/dashboardV3/loadShell";
import { CURRENT_SITE_COOKIE, pickCurrentSite } from "@/lib/dashboardV3/sites";
import { loadSiteStats } from "@/lib/dashboardV3/homeData";
import { taskVariantFor } from "@/lib/dashboardV3/tasks";

export const dynamic = "force-dynamic";
export const metadata = { title: "My websites" };

/** Every website, store, course, blog and app as a card (v3 dashboard; simple view uses AllSitesBoard). */
export default async function SitesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { show } = await searchParams;
  const ctx = await requireHubContext("/dashboard/sites");

  if (ctx.experience !== "pro") {
    const sites = await loadV3Sites(ctx.organizationId, ctx.userId);
    const rows: BoardSite[] = await Promise.all(
      sites.map(async (site, i) => ({
        site,
        stats: i < 24 ? (await loadSiteStats(site, taskVariantFor({ kind: site.kind })).catch(() => null))?.stats ?? [] : [],
      })),
    );
    const jar = await cookies();
    const current = pickCurrentSite(sites, jar.get(CURRENT_SITE_COOKIE)?.value);
    return <AllSitesBoard rows={rows} currentSiteId={current?.id ?? null} />;
  }

  const sites = await loadHubSiteCards(ctx.organizationId, ctx.userId);
  return <SitesList sites={sites} experience={ctx.experience} initialFilter={parseSiteFilter(show)} />;
}
