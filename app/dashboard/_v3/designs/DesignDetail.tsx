import "./designs.css";
import { ArrowLeft, Check, Layers, Users } from "lucide-react";
import type { MarketplaceDetail } from "@/lib/marketplace";
import { designKindLabel, designPrice } from "@/lib/dashboardV3/designs";
import { Badge, ButtonLink, Card } from "../ui";
import { DesignAction } from "./DesignAction";

/** One design, big: a live picture, what it is, and the one button to use it. */
export function DesignDetail({ detail, autoUse }: { detail: MarketplaceDetail; autoUse: boolean }) {
  const isFree = detail.priceCents === 0;
  const isEmail = detail.kind === "EMAIL";
  return (
    <div className="plx-page plx-dz">
      <div>
        <ButtonLink href="/dashboard/marketplace" variant="ghost" size="sm" leftIcon={<ArrowLeft size={16} aria-hidden />}>
          All designs
        </ButtonLink>
      </div>
      <div className="plx-dzdet">
        <div className="plx-dzdet__shot">
          {detail.compiledHtml ? (
            <iframe title={`Picture of ${detail.name}`} srcDoc={detail.compiledHtml} sandbox="" />
          ) : (
            <div className="plx-dzprev__state" style={{ height: 360 }}>
              <Layers size={34} aria-hidden />
              <span>No picture yet</span>
            </div>
          )}
        </div>
        <Card padding="lg" className="plx-dzdet__side">
          <div className="plx-dzdet__tags">
            <Badge>{designKindLabel(detail.kind)}</Badge>
            {detail.category ? <Badge tone="brand">{detail.category}</Badge> : null}
            <Badge tone={isFree ? "success" : "neutral"}>{designPrice(detail.priceCents)}</Badge>
          </div>
          <h1 className="plx-h1">{detail.name}</h1>
          {detail.description ? <p className="plx-body">{detail.description}</p> : null}
          <p className="plx-small" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Users size={16} aria-hidden /> Used by {detail.purchaseCount.toLocaleString()} {detail.purchaseCount === 1 ? "person" : "people"}
          </p>
          <ul className="plx-dzdet__list">
            <li><Check size={18} aria-hidden /> Change every word and picture</li>
            <li><Check size={18} aria-hidden /> Looks right on phones, tablets and computers</li>
            <li><Check size={18} aria-hidden /> {isEmail ? "Ready to send from your emails" : "Ready to put on your own web address"}</li>
          </ul>
          <DesignAction designId={detail.id} kind={detail.kind} isFree={isFree} owned={detail.owned} autoUse={autoUse} />
        </Card>
      </div>
    </div>
  );
}
