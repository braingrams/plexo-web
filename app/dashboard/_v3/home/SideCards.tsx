"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { NEW_SITE_PATH } from "@/lib/dashboardV3/newSite";
import { openSiteSwitcher, SWITCHER_PANEL_STEP } from "@/lib/dashboardV3/siteSwitcherEvents";
import { useOptionalTour } from "../tour/TourProvider";
import { useState } from "react";
import { SolGlyph } from "@/app/dashboard/_v3/sol/SolGlyph";
import { Check, ChevronRight, Copy, Mail, Package, Pencil, Plus, ShoppingBag } from "lucide-react";
import { shopQuickLinks } from "@/lib/dashboardV3/commerceNav";
import { NEW_EMAIL_HREF } from "@/lib/dashboardV3/emails";
import { liveHref, OPEN_SITE_HINT } from "@/lib/dashboardV3/siteLinks";
import type { SiteSummary } from "@/lib/dashboardV3/sites";
import { Button, ButtonLink, Card, StatusPill } from "../ui";
import type { HomeBrand } from "./homeTypes";
import { OpenSiteButton, PreviewButton } from "./SiteButtons";
import { Shot } from "../hub/SitePicture";

/** The live address (https) only when the site is online; never a preview. */
export function siteHref(s: SiteSummary) {
  return liveHref(s);
}

/** What the site looks like right now, in the owner's own colour, with Edit and Preview. */
export function SitePreviewCard({ site, brand }: { site: SiteSummary; brand: HomeBrand }) {
  const href = siteHref(site);
  return (
    <Card padding="none" style={{ overflow: "hidden" }} data-tour="home-site-card">
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, background: "var(--plx-elevated)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <StatusPill status={site.status} label={site.status === "live" ? "Online" : "Not online yet"} />
          <span className="plx-small">{site.kind}</span>
        </div>
        <Shot id={site.id} colour={brand.color || "var(--plx-sunken)"} />
        <div style={{ minWidth: 0 }}>
          <div className="plx-h3" style={{ overflowWrap: "anywhere" }}>{site.name}</div>
          <div className="plx-small" style={{ overflowWrap: "anywhere" }}>{site.address ?? "No web address yet"}</div>
        </div>
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <ButtonLink href={`/dashboard/sites/${site.id}`} variant="strong" leftIcon={<Pencil size={16} aria-hidden />} style={{ flex: "1 1 130px" }}>
            Edit site
          </ButtonLink>
          {/* Preview is always the private working copy. Open my site is only the live address. */}
          <PreviewButton site={site} style={{ flex: "1 1 130px" }} />
        </div>
        {/* Open and Copy only mean something once there is a live address, so they appear then instead of sitting greyed out. */}
        {href ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <OpenSiteButton site={site} style={{ flex: "1 1 150px" }} />
            <CopyLinkButton address={site.address} style={{ flex: "1 1 130px" }} />
          </div>
        ) : (
          <span className="plx-small">{OPEN_SITE_HINT}. Until then, Preview shows what you have so far.</span>
        )}
      </div>
    </Card>
  );
}

export function AskSolCard({ prompt }: { prompt: string }) {
  return (
    <Card data-tour="home-ask-sol" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="plx-h3">Ask SOL</span>
      <span className="plx-body">“{prompt}” SOL builds it for you and asks before guessing.</span>
      <ButtonLink href="/dashboard/sol" variant="secondary" leftIcon={<SolGlyph size={18} />}>
        Tell SOL what you want
      </ButtonLink>
    </Card>
  );
}

/** Copies the site's live link and says so. Disabled (not hidden) until the site has an address. */
export function CopyLinkButton({ address, variant = "secondary", disabled, style }: { address?: string | null; variant?: "secondary" | "strong"; disabled?: boolean; style?: React.CSSProperties }) {
  const [copied, setCopied] = useState(false);
  if (!address && !disabled) return null;
  return (
    <Button
      variant={variant}
      disabled={disabled || !address}
      title={!address ? OPEN_SITE_HINT : undefined}
      style={style}
      leftIcon={copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
      onClick={async () => {
        if (!address) return;
        try {
          await navigator.clipboard.writeText(`https://${address}`);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2500);
        } catch {
          window.prompt("Copy your link", `https://${address}`);
        }
      }}
    >
      {copied ? "Link copied" : "Copy link"}
    </Button>
  );
}

function ActionRow({ href, icon: Icon, title, sub, tour }: { href: string; icon: React.ComponentType<{ size?: number }>; title: string; sub: string; tour?: string }) {
  return (
    <li>
      <Link href={href} className="plx-action" data-tour={tour}>
        <span className="plx-action__icon" aria-hidden><Icon size={20} /></span>
        <span className="plx-action__text">
          <span className="plx-action__title">{title}</span>
          <span className="plx-action__sub">{sub}</span>
        </span>
        <ChevronRight size={18} aria-hidden className="plx-action__go" />
      </Link>
    </li>
  );
}

/**
 * One control for everything about your websites: see them all, switch, or start another. It opens the site
 * switcher and shows what it is (the tour's "All your sites" step), so people learn where it lives. Screens
 * without the switcher (Everything view) go to the sites list, which has the same three things.
 */
function AllSitesRow({ newSiteHref }: { newSiteHref: string }) {
  const router = useRouter();
  const tour = useOptionalTour();
  const go = () => {
    if (!openSiteSwitcher()) return router.push(newSiteHref === NEW_SITE_PATH ? "/dashboard/sites" : newSiteHref);
    // Show them what just opened, once; after that it simply opens.
    if (tour && !(tour.state.doneAreas ?? []).includes("sites")) tour.startArea("sites", SWITCHER_PANEL_STEP);
  };
  return (
    <li>
      <button type="button" className="plx-action" data-tour="home-create-another" onClick={go} style={{ width: "100%", background: "none", border: 0, font: "inherit", textAlign: "left", cursor: "pointer" }}>
        <span className="plx-action__icon" aria-hidden><Plus size={20} /></span>
        <span className="plx-action__text">
          <span className="plx-action__title">All my websites</span>
          <span className="plx-action__sub">See them all, switch, or create another. Your first keeps running.</span>
        </span>
        <ChevronRight size={18} aria-hidden className="plx-action__go" />
      </button>
    </li>
  );
}

/** One tidy card for the things people do next that aren't about this one site: SOL, email, another website. */
export function OtherActionsCard({ solPrompt, newSiteHref }: { solPrompt: string; newSiteHref: string }) {
  return (
    <Card padding="none" data-tour="home-actions">
      <h2 className="plx-card__title" style={{ padding: "18px 20px 6px" }}>Other actions</h2>
      <ul className="plx-actions">
        <ActionRow href="/dashboard/sol" icon={SolGlyph} title="Ask SOL" sub={`Try: “${solPrompt}”`} tour="home-ask-sol" />
        <ActionRow href={NEW_EMAIL_HREF} icon={Mail} title="Make an email" sub="A welcome note, receipt or newsletter" tour="home-make-email" />
        <AllSitesRow newSiteHref={newSiteHref} />
      </ul>
    </Card>
  );
}

/** For shops: the three things an owner does most, one tap each, whatever view they use. */
export function ShopActionsCard({ siteId }: { siteId: string }) {
  const icons = { add: Plus, manage: Package, orders: ShoppingBag } as const;
  return (
    <Card padding="none" data-tour="home-shop-actions">
      <h2 className="plx-card__title" style={{ padding: "18px 20px 6px" }}>Your shop</h2>
      <ul className="plx-actions">
        {shopQuickLinks(siteId).map((l) => (
          <ActionRow key={l.id} href={l.href} icon={icons[l.id]} title={l.label} sub={l.sub} tour={`home-shop-${l.id}`} />
        ))}
      </ul>
    </Card>
  );
}
