import "./designs.css";
import { Plus } from "lucide-react";
import { ButtonLink, TabLinks } from "../ui";

export type DesignsTab = "browse" | "listings" | "earnings" | "sell";

const HREF: Record<DesignsTab, string> = {
  browse: "/dashboard/marketplace",
  listings: "/dashboard/marketplace/listings",
  earnings: "/dashboard/marketplace/payouts",
  sell: "/dashboard/marketplace/sell",
};

/** The top of every Designs screen: what this is, the way to sell your own, and the three places inside it. */
export function DesignsFrame({ tab, title, intro, children, hideSell }: { tab: DesignsTab; title: string; intro: string; children: React.ReactNode; hideSell?: boolean }) {
  const current = tab === "sell" ? HREF.listings : HREF[tab];
  return (
    <div className="plx-page plx-dz" data-tour="designs-main">
      <header className="plx-dz__head">
        <div>
          <h1 className="plx-h1">{title}</h1>
          <p>{intro}</p>
        </div>
        {hideSell ? null : (
          <ButtonLink href={HREF.sell} leftIcon={<Plus size={18} aria-hidden />}>
            Sell a design
          </ButtonLink>
        )}
      </header>
      <TabLinks
        label="Designs"
        current={current}
        items={[
          { href: HREF.browse, label: "Browse designs" },
          { href: HREF.listings, label: "My designs for sale" },
          { href: HREF.earnings, label: "Earnings" },
        ]}
      />
      {children}
    </div>
  );
}
