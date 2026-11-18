"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ChevronRight, Copy, Mail, MessageCircle, Pencil, Plus } from "lucide-react";
import { NEW_EMAIL_HREF } from "@/lib/dashboardV3/emails";
import { liveHref, OPEN_SITE_HINT } from "@/lib/dashboardV3/siteLinks";
import type { SiteSummary } from "@/lib/dashboardV3/sites";
import { Button, ButtonLink, Card, StatusPill } from "../ui";
import type { HomeBrand } from "./homeTypes";
import { OpenSiteButton, PreviewButton } from "./SiteButtons";

/** The live address (https) only when the site is online; never a preview. */
export function siteHref(s: SiteSummary) {
  return liveHref(s);
}

/** What the site looks like right now, in the owner's own colour, with Edit and Preview. */
export function SitePreviewCard({ site, brand }: { site: SiteSummary; brand: HomeBrand }) {
  const href = siteHref(site);
  const initial = (site.name.trim()[0] ?? "S").toUpperCase();
  return (
    <Card padding="none" style={{ overflow: "hidden" }} data-tour="home-site-card">
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, background: "var(--plx-elevated)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <StatusPill status={site.status} label={site.status === "live" ? "Online" : "Not online yet"} />
          <span className="plx-small">{site.kind}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt="" width={44} height={44} style={{ borderRadius: 12, objectFit: "cover", background: "var(--plx-surface)" }} />
          ) : (
            <span aria-hidden style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 20, background: brand.color || "var(--plx-brand)", color: brand.color ? "white" : "var(--plx-on-brand)" }}>
              {initial}
            </span>
          )}
          <div style={{ minWidth: 0 }}>
            <div className="plx-h3" style={{ overflowWrap: "anywhere" }}>{site.name}</div>
            <div className="plx-small" style={{ overflowWrap: "anywhere" }}>{site.address ?? "No web address yet"}</div>
          </div>
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
      <ButtonLink href="/dashboard/sol" variant="secondary" leftIcon={<MessageCircle size={18} aria-hidden />}>
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

function ActionRow({ href, icon: Icon, title, sub, tour }: { href: string; icon: typeof Mail; title: string; sub: string; tour?: string }) {
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

/** One tidy card for the things people do next that aren't about this one site: SOL, email, another website. */
export function OtherActionsCard({ solPrompt, newSiteHref }: { solPrompt: string; newSiteHref: string }) {
  return (
    <Card padding="none" data-tour="home-actions">
      <h2 className="plx-card__title" style={{ padding: "18px 20px 6px" }}>Other actions</h2>
      <ul className="plx-actions">
        <ActionRow href="/dashboard/sol" icon={MessageCircle} title="Ask SOL" sub={`Try: “${solPrompt}”`} tour="home-ask-sol" />
        <ActionRow href={NEW_EMAIL_HREF} icon={Mail} title="Make an email" sub="A welcome note, receipt or newsletter" tour="home-make-email" />
        <ActionRow href={newSiteHref} icon={Plus} title="Create another website" sub="Your first one keeps running as it is" tour="home-create-another" />
      </ul>
    </Card>
  );
}
