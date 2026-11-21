import "@/app/dashboard/commerce/_components/cmx.css";
import { WalletContent } from "@/app/dashboard/commerce/[templateId]/wallet/Content";
import { DonationsContent } from "@/app/dashboard/commerce/[templateId]/donations/Content";
import { PaymentsSettingsContent } from "@/app/dashboard/commerce/[templateId]/settings/payments/Content";
import { DonationsHubView, type DonationSubTab } from "./DonationsHubView";

/**
 * The Donations tab: clean 3-subtabs layout (Home, Wallet, Payment settings) right in the header,
 * with no clutter or duplicate sidebar navigation.
 */
export async function DonationsArea({
  siteId,
  section: requested,
  searchParams,
}: {
  siteId: string;
  section?: unknown;
  part?: unknown;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const subParam = typeof searchParams.sub === "string" ? searchParams.sub : Array.isArray(searchParams.sub) ? searchParams.sub[0] : undefined;
  const initialSub: DonationSubTab =
    subParam === "wallet" || requested === "money"
      ? "wallet"
      : subParam === "payments" || requested === "settings"
        ? "payments"
        : "home";

  return (
    <DonationsHubView
      siteId={siteId}
      initialSub={initialSub}
      home={<DonationsContent templateId={siteId} hub />}
      wallet={<WalletContent templateId={siteId} searchParams={searchParams} hub store={false} />}
      payments={<PaymentsSettingsContent templateId={siteId} hub />}
    />
  );
}
