import { Tag } from "lucide-react";
import { Badge, ButtonLink } from "../ui";
import { formatMoney } from "@/lib/commerce/formatMoney";

/** The course's price at a glance above its lessons, with a way to change it. */
export function PriceStrip({ courseId, paid, priceMinor, currency }: { courseId: string; paid: boolean; priceMinor: number | null; currency: string }) {
  return (
    <div className="plx-card plx-card--pad" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", justifyContent: "space-between" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="plx-sum__ic"><Tag size={20} aria-hidden /></span>
        <span>
          <b style={{ fontSize: 17 }}>{paid && priceMinor ? formatMoney(priceMinor, currency) : paid ? "Paid, price not set" : "Free"}</b>
          <span className="plx-small" style={{ display: "block" }}>{paid ? "People pay once to join." : "Anyone can join for free."}</span>
        </span>
        {paid ? <Badge tone="brand">Paid</Badge> : null}
      </span>
      <ButtonLink href={`/dashboard/learners/${courseId}/settings`} variant="secondary">Change price</ButtonLink>
    </div>
  );
}
