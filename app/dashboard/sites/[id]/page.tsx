import { HubFrame } from "../../_v3/hub/HubFrame";
import { AppTab } from "../../_v3/hub/AppTab";
import { PagesTab } from "../../_v3/hub/PagesTab";
import { ProductsTab } from "../../_v3/hub/ProductsTab";
import { OrdersTab } from "../../_v3/hub/OrdersTab";
import { AddressTab } from "../../_v3/hub/AddressTab";
import { BlogTab } from "../../_v3/hub/BlogTab";
import { CourseTab } from "../../_v3/hub/CourseTab";
import { BrandTab, type HubBrand } from "../../_v3/hub/BrandTab";
import { VisitsTab } from "../../_v3/hub/VisitsTab";
import { SettingsTab } from "../../_v3/hub/SettingsTab";
import { AddMoreCards } from "../../_v3/hub/AddMore";
import { hubTabs, resolveHubTab } from "@/lib/dashboardV3/hubTabs";
import { loadHubPages, loadHubProducts, loadHubSite, loadHubVisits, requireHubContext } from "@/lib/dashboardV3/hubData";

export const dynamic = "force-dynamic";

/** One place per site: only the tabs it uses, and "Add more to your site" for the rest. */
export default async function SiteHubPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requireHubContext(`/dashboard/sites/${id}`);
  const site = await loadHubSite(ctx.organizationId, id);
  const tab = resolveHubTab(Array.isArray(query.tab) ? query.tab[0] : query.tab, site.features, ctx.experience);
  const tabs = hubTabs(site.features, ctx.experience);

  let content: React.ReactNode;
  switch (tab) {
    case "app":
      content = site.app ? <AppTab siteId={id} siteName={site.name} info={site.app} /> : null;
      break;
    case "products":
      content = <ProductsTab siteId={id} products={await loadHubProducts(id)} currency={site.currency} experience={ctx.experience} startWithService={query.new === "service"} />;
      break;
    case "orders":
      content = <OrdersTab siteId={id} currency={site.currency} />;
      break;
    case "blog":
      content = <BlogTab siteId={id} experience={ctx.experience} />;
      break;
    case "course":
      content = <CourseTab siteId={id} experience={ctx.experience} />;
      break;
    case "brand":
      content = <BrandTab siteId={id} siteName={site.name} brand={site.brand ?? null} defaults={ctx.brand as HubBrand} experience={ctx.experience} sourceType={site.sourceType} />;
      break;
    case "address":
      content = <AddressTab siteId={id} siteName={site.name} experience={ctx.experience} />;
      break;
    case "visits":
      content = <VisitsTab visits={await loadHubVisits(id)} />;
      break;
    case "settings":
      content = <SettingsTab site={site} features={site.features} experience={ctx.experience} />;
      break;
    default: {
      const pages = await loadHubPages(ctx.organizationId, id);
      content = (
        <>
          <PagesTab site={site} pages={pages} experience={ctx.experience} />
          <AddMoreCards siteId={id} siteName={site.name} features={site.features} />
        </>
      );
    }
  }

  return (
    <HubFrame site={site} tabs={tabs} current={tab} experience={ctx.experience}>
      {content}
    </HubFrame>
  );
}
