import "@/app/dashboard/commerce/_components/cmx.css";
import { CommerceProduct, CommerceSettings } from "@/lib/db/commerceEntities";
import { resolveShopSection, shopSections, parseSettingsPart, shopNavGroups, currentShopNavKey, type ShopSectionId } from "@/lib/dashboardV3/shopSections";
import { TabBar } from "../HubFrame";
import { ShopLayout } from "./ShopNav";
import { WalletContent } from "@/app/dashboard/commerce/[templateId]/wallet/Content";
import { CustomersPanel } from "./CustomersPanel";
import { DeliveryPanel, DiscountsPanel } from "../ProductTools";
import { AvailabilityContent } from "@/app/dashboard/commerce/[templateId]/availability/Content";
import { DonationsContent } from "@/app/dashboard/commerce/[templateId]/donations/Content";
import { GeneralSettingsContent } from "@/app/dashboard/commerce/[templateId]/settings/general/Content";
import { PaymentsSettingsContent } from "@/app/dashboard/commerce/[templateId]/settings/payments/Content";
import { CheckoutSettingsContent } from "@/app/dashboard/commerce/[templateId]/settings/checkout/Content";
import { NotificationsSettingsContent } from "@/app/dashboard/commerce/[templateId]/settings/notifications/Content";

/**
 * The Shop tab: the shop tools that used to live on their own old pages, now inside the site's hub with the same
 * look, one row of choices and an address for each. The business logic is the old pages' own (their Content
 * components); only the frame is new.
 */
export async function ShopArea({ siteId, section: requested, part: requestedPart, searchParams }: { siteId: string; section?: unknown; part?: unknown; searchParams: Record<string, string | string[] | undefined> }) {
  // Booking times only appear once the shop sells a service (or when someone opens them on purpose).
  const [{ data: products }, { data: shop }] = await Promise.all([CommerceProduct.query.primary({ templateId: siteId }).go({ pages: "all", attributes: ["kind"] }), CommerceSettings.get({ templateId: siteId }).go()]);
  const currency = shop?.currency ?? "NGN";
  const store = Boolean(shop?.enabled) && (products.length > 0 || !shop?.donationsEnabled);
  const sellsServices = products.some((p) => p.kind === "SERVICE") || requested === "bookings";
  const sections = shopSections({ sellsServices, store });
  const section: ShopSectionId = resolveShopSection(requested, sections);
  const part = parseSettingsPart(requestedPart);
  const groups = shopNavGroups(sections, { store });
  const key = currentShopNavKey(section, part);
  const allItems = groups.flatMap((g) => g.items);
  const info = allItems.find((i) => i.key === key) ?? allItems[0];
  const activeKey = info?.key ?? key;

  let body: React.ReactNode;
  switch (section) {
    case "money":
      body = <WalletContent templateId={siteId} searchParams={searchParams} hub />;
      break;
    case "customers":
      body = <CustomersPanel templateId={siteId} />;
      break;
    case "discounts":
      body = <DiscountsPanel siteId={siteId} currency={currency} />;
      break;
    case "delivery":
      body = <DeliveryPanel siteId={siteId} currency={currency} />;
      break;
    case "bookings":
      body = <AvailabilityContent templateId={siteId} hub />;
      break;
    case "donations":
      body = <DonationsContent templateId={siteId} hub />;
      break;
    default:
      body = (
        <>
          {part === "payments" ? <PaymentsSettingsContent templateId={siteId} hub /> : part === "checkout" ? <CheckoutSettingsContent templateId={siteId} hub /> : part === "notifications" ? <NotificationsSettingsContent templateId={siteId} hub /> : <GeneralSettingsContent templateId={siteId} hub />}
        </>
      );
  }

  return (
    <>
      <ShopLayout siteId={siteId} groups={groups} current={activeKey} label={store ? "Shop" : "Payments"}>
        <TabBar title={info?.label ?? "Payments"} sub={info?.help ?? ""} />
        <div data-tour="hub-shop">{body}</div>
      </ShopLayout>
    </>
  );
}
