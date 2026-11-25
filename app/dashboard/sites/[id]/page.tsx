import { HubFrame } from "../../_v3/hub/HubFrame";
import { AppTab } from "../../_v3/hub/AppTab";
import { PagesTab } from "../../_v3/hub/PagesTab";
import { ProductsTab } from "../../_v3/hub/ProductsTab";
import { OrdersTab } from "../../_v3/hub/OrdersTab";
import { ShopArea } from "../../_v3/hub/shop/ShopArea";
import { DonationsArea } from "../../_v3/hub/shop/DonationsArea";
import { AddressTab } from "../../_v3/hub/AddressTab";
import { BlogTab } from "../../_v3/hub/BlogTab";
import { CourseTab } from "../../_v3/hub/CourseTab";
import { BrandTab, type HubBrand } from "../../_v3/hub/BrandTab";
import { VisitsTab } from "../../_v3/hub/VisitsTab";
import { HealthTab } from "../../_v3/hub/HealthTab";
import { SettingsTab } from "../../_v3/hub/SettingsTab";
import { AddMoreCards } from "../../_v3/hub/AddMore";
import { MoreTab } from "../../_v3/hub/MoreTab";
import { AdvancedArea } from "../../_v3/hub/advanced/AdvancedArea";
import { notFound } from "next/navigation";
import { hubTabs, resolveHubTab } from "@/lib/dashboardV3/hubTabs";
import { advancedKind, advancedSections, resolveAdvancedSection } from "@/lib/dashboardV3/hubAdvanced";
import { loadAdvancedData, loadServerPlan } from "@/lib/dashboardV3/hubAdvancedData";
import { loadV3Sites } from "@/lib/dashboardV3/loadShell";
import { guestAccessFor } from "@/lib/access/siteAccessStore";
import { guestFirstTab, guestHubTabAllowed } from "@/lib/access/siteAccess";
import { TourAnchorAbsent } from "../../_v3/tour/TourAnchorAbsent";
import { loadHubPages, loadHubProducts, loadHubSite, loadHubStartFacts, loadHubVisits, requireHubContext } from "@/lib/dashboardV3/hubData";

export const dynamic = "force-dynamic";

const examplePages = (pages: { name: string; path: string }[]) => pages.map((p) => ({ name: p.name, path: p.path }));

/** One place per site: only the tabs it uses, and "Add more to your site" for the rest. */
export default async function SiteHubPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requireHubContext(`/dashboard/sites/${id}`);
  const site = await loadHubSite(ctx.organizationId, id);
  // A member invited to this site only gets the tabs their role allows. Settings, Advanced, Web address and More (domains, code,
  // transfer, delete, money) are never among them, whatever the role.
  const access = await guestAccessFor(ctx.userId, ctx.organizationId);
  const guestRole = access ? access[id] : undefined;
  if (access && !guestRole) notFound();
  const allTabs = hubTabs(site.features, ctx.experience);
  const tabs = guestRole ? allTabs.filter((t) => guestHubTabAllowed(guestRole, t.id)) : allTabs;
  const wanted = resolveHubTab(Array.isArray(query.tab) ? query.tab[0] : query.tab, site.features, ctx.experience);
  const tab = guestRole ? (tabs.find((t) => t.id === wanted)?.id ?? (tabs[0]?.id ?? guestFirstTab(guestRole)) as typeof wanted) : wanted;

  // A site that is not online yet gets the "here's what to do next" steps on its Pages tab (the owner, not an invited guest).
  const startFacts = tab === "pages" && !guestRole ? await loadHubStartFacts(site).catch(() => null) : null;
  const start = startFacts?.eligible && !startFacts.published ? startFacts : null;
  const showSolIntro = start ? (await loadV3Sites(ctx.organizationId, ctx.userId).catch(() => [])).length <= 1 : false;

  let content: React.ReactNode;
  switch (tab) {
    case "app":
      content = site.app ? <AppTab siteId={id} siteName={site.name} info={site.app} experience={ctx.experience} /> : null;
      break;
    case "products":
      content = <ProductsTab siteId={id} products={await loadHubProducts(id)} currency={site.currency} experience={ctx.experience} startNew={query.new === "service" ? "service" : query.new === "product" ? "product" : undefined} />;
      break;
    case "orders":
      content = <OrdersTab siteId={id} currency={site.currency} />;
      break;
    case "shop":
      content = <ShopArea siteId={id} section={Array.isArray(query.section) ? query.section[0] : query.section} part={Array.isArray(query.part) ? query.part[0] : query.part} searchParams={query} />;
      break;
    case "donations":
      content = <DonationsArea siteId={id} section={Array.isArray(query.section) ? query.section[0] : query.section} part={Array.isArray(query.part) ? query.part[0] : query.part} searchParams={query} />;
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
      content = <VisitsTab visits={await loadHubVisits(id)} siteId={id} live={site.status === "live"} gaResult={Array.isArray(query.ga) ? query.ga[0] : query.ga} />;
      break;
    case "health":
      content = <HealthTab siteId={id} siteName={site.name} live={site.status === "live"} editHref={site.editHref} />;
      break;
    case "settings":
      content = <SettingsTab site={site} features={site.features} experience={ctx.experience} />;
      break;
    case "more": {
      const pages = await loadHubPages(ctx.organizationId, id).catch(() => []);
      content = <MoreTab site={site} features={site.features} pages={examplePages(pages)} experience={ctx.experience} />;
      break;
    }
    case "advanced": {
      // Pros only (hubTabs never offers it otherwise): the old per-site tools, shown here in place.
      const plan = await loadServerPlan(ctx.organizationId);
      const sections = advancedSections({ kind: advancedKind(site.features), experience: ctx.experience, ssrEnabled: plan.ssrEnabled, server: site.app?.kind === "server", ownCode: site.features.ownCode });
      const section = resolveAdvancedSection(Array.isArray(query.section) ? query.section[0] : query.section, sections);
      content = section ? <AdvancedArea site={site} sections={sections} current={section} data={await loadAdvancedData(ctx.organizationId, id, section, plan.allowedTiers)} /> : null;
      break;
    }
    default: {
      const pages = await loadHubPages(ctx.organizationId, id);
      content = (
        <>
          <PagesTab site={site} pages={pages} experience={ctx.experience} plan={ctx.plan} />
          {guestRole ? <TourAnchorAbsent anchor="hub-add-more" /> : <AddMoreCards siteId={id} siteName={site.name} features={site.features} pages={examplePages(pages)} />}
        </>
      );
    }
  }

  return (
    <HubFrame site={site} tabs={tabs} current={tab} experience={ctx.experience} readOnly={guestRole !== undefined && guestRole !== "editor"} guest={guestRole !== undefined} start={start ?? undefined} showSolIntro={showSolIntro}>
      {content}
    </HubFrame>
  );
}
