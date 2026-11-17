import { Badge, ButtonLink, Card, EmptyState } from "../ui";
import { DesignsFrame } from "./DesignsFrame";
import { designKindLabel, designPrice, listingStatus } from "@/lib/dashboardV3/designs";

export type ListingRow = { id: string; name: string; kind: string; marketplaceStatus: string; marketplaceRejectionReason: string | null; priceCents: number; purchaseCount: number };

export function ListingsView({ listings }: { listings: ListingRow[] }) {
  return (
    <DesignsFrame tab="listings" title="My designs for sale" intro="Designs you have put up for others to use. You keep most of every sale." hideSell={listings.length === 0}>
      {listings.length === 0 ? (
        <EmptyState
          title="You have not put a design up for sale yet"
          body="Made a page or an email you are proud of? Share it and earn money each time someone uses it."
          action={<ButtonLink href="/dashboard/marketplace/sell">Sell a design</ButtonLink>}
        />
      ) : (
        <div className="plx-dzlist">
          {listings.map((l) => {
            const s = listingStatus(l.marketplaceStatus);
            return (
              <Card key={l.id}>
                <div className="plx-dzrow">
                  <div className="plx-dzrow__main">
                    <h2 className="plx-dzrow__title">{l.name}</h2>
                    <p className="plx-dzrow__meta">
                      {designKindLabel(l.kind)} · {designPrice(l.priceCents)} · {l.purchaseCount} {l.purchaseCount === 1 ? "sale" : "sales"}
                    </p>
                    <p className="plx-dzrow__meta">{s.hint}</p>
                    {l.marketplaceStatus === "REJECTED" && l.marketplaceRejectionReason ? <p className="plx-dzrow__why">{l.marketplaceRejectionReason}</p> : null}
                  </div>
                  <Badge tone={s.tone === "neutral" ? "neutral" : s.tone} dot>
                    {s.label}
                  </Badge>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </DesignsFrame>
  );
}
