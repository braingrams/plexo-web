import { loadHubSiteCards, requireHubContext } from "@/lib/dashboardV3/hubData";
import { SitesList } from "../_v3/hub/SitesList";

export const dynamic = "force-dynamic";
export const metadata = { title: "My websites" };

/** Every website, store, course, blog and app as a card (v3 dashboard; off = the old dashboard). */
export default async function SitesPage() {
  const ctx = await requireHubContext("/dashboard/sites");
  const sites = await loadHubSiteCards(ctx.organizationId, ctx.userId);
  return <SitesList sites={sites} experience={ctx.experience} />;
}
