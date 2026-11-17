import { loadHubSiteCards, requireHubContext } from "@/lib/dashboardV3/hubData";
import { NewSiteFlow } from "../../_v3/newsite/NewSiteFlow";
import { NEW_SITE_PATH } from "@/lib/dashboardV3/newSite";

export const dynamic = "force-dynamic";
export const metadata = { title: "Make a new website" };

/** The new-look "Make a new website", as a page (deep links, and where /dashboard/new sends new-dashboard users). */
export default async function NewSitePage() {
  const ctx = await requireHubContext(NEW_SITE_PATH);
  const sites = await loadHubSiteCards(ctx.organizationId, ctx.userId);
  return (
    <NewSiteFlow
      mode="page"
      context={{
        plan: ctx.plan,
        brand: ctx.brand as { name?: string } | null,
        siteNames: sites.map((s) => s.name),
        liveSiteNames: sites.filter((s) => s.status === "live").map((s) => s.name),
      }}
    />
  );
}
