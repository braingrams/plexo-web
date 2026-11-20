"use client";

import "./hub.css";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ExternalLink, Eye, Upload } from "lucide-react";
import { Badge, Button, ButtonLink, HelpMedia, ScrollRail, StatusPill, TabLinks } from "../ui";
import { EditWebsiteButton } from "./EditWebsiteButton";
import { OpenSiteButton, PreviewButton } from "../home/SiteButtons";
import { liveHref, previewHref } from "@/lib/dashboardV3/siteLinks";
import { hubTabHref, type HubTab, type HubTabId } from "@/lib/dashboardV3/hubTabs";
import type { Experience } from "@/lib/dashboardV3/nav";
import type { HubSite } from "@/lib/dashboardV3/hubData";

export type HubFrameSite = Pick<HubSite, "id" | "name" | "kind" | "status" | "address" | "editHref" | "sourceType" | "designFormat"> & { deployed?: "server" | "static" | null };

const HELP: Record<HubTabId, string> = {
  app: "How to update your app",
  pages: "How to add and change pages",
  products: "How to add a product",
  orders: "How to handle an order",
  shop: "How to set up payments and get paid",
  blog: "How to write a blog post",
  course: "How to add a lesson",
  brand: "How to change your colours and logo",
  address: "How to choose your web address",
  visits: "How to read your visits",
  health: "How to make your site faster",
  settings: "How to change your site's settings",
  advanced: "How to use the advanced settings",
};

export function builderLabel(site: Pick<HubFrameSite, "sourceType" | "designFormat"> & { deployed?: "server" | "static" | null }): string {
  if (site.deployed === "server") return "Your own server code";
  if (site.deployed === "static") return "Your own app files";
  if (site.sourceType === "REACT_PROJECT") return "App builder";
  if (site.sourceType === "RAW_UPLOAD") return "Your own code";
  return site.designFormat === "v2" ? "Visual editor" : "Visual editor (classic)";
}

/** The top of a site's hub: who it is, whether it's live, the two main buttons, and only the tabs it uses. */
function FoldedSiteActions({ site }: { site: HubFrameSite }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const live = liveHref(site);

  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", click);
    return () => document.removeEventListener("mousedown", click);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)} rightIcon={<ChevronDown size={14} aria-hidden style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s ease" }} />}>
        View site
      </Button>
      {open ? (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50, minWidth: 190, padding: 6, borderRadius: 12, background: "var(--plx-surface)", border: "1px solid var(--plx-border)", boxShadow: "var(--plx-shadow-dropdown)", display: "flex", flexDirection: "column", gap: 2 }}>
          <a href={previewHref(site.id)} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, color: "var(--plx-text)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
            <Eye size={16} aria-hidden /> Preview draft
          </a>
          {live ? (
            <a href={live} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, color: "var(--plx-text)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
              <ExternalLink size={16} aria-hidden /> Open live site
            </a>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, color: "var(--plx-muted)", fontSize: 13 }}>
              <ExternalLink size={16} aria-hidden /> Not online yet
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function HubFrame({ site, tabs, current, experience, children }: { site: HubFrameSite; tabs: HubTab[]; current: HubTabId; experience: Experience; children: React.ReactNode }) {
  const currentHref = hubTabHref(site.id, current);
  return (
    <div className="plx-page plx-hub" data-tour="hub-main">
      <div>
        <Link href="/dashboard/sites" className="plx-hub__back">
          <ArrowLeft size={18} aria-hidden /> {experience === "beginner" ? "My websites" : "All sites"}
        </Link>
      </div>
      <header className="plx-hub__head">
        <div className="plx-hub__id">
          <div className="plx-hub__title">
            <h1 className="plx-h1">{site.name}</h1>
            <StatusPill status={site.status} />
          </div>
          <div className="plx-hub__meta">
            <Badge tone="brand">{site.kind}</Badge>
            {site.address ? (
              <a href={`https://${site.address}`} target="_blank" rel="noreferrer">
                {site.address} <ExternalLink size={14} aria-hidden />
              </a>
            ) : (
              <Link href={hubTabHref(site.id, "address")} style={{ fontWeight: 600 }}>
                Not online yet. Choose a web address
              </Link>
            )}
            {experience === "pro" ? <span className="plx-hub__builder">Built with: {builderLabel(site)}</span> : null}
          </div>
        </div>
        <div className="plx-hub__actions" data-tour="hub-actions">
          {current === "settings" ? (
            <FoldedSiteActions site={site} />
          ) : (
            <>
              <PreviewButton site={site} />
              <OpenSiteButton site={site} />
            </>
          )}
          {site.deployed ? (
            <ButtonLink href={hubTabHref(site.id, "app")} leftIcon={<Upload size={16} aria-hidden />}>
              Update app
            </ButtonLink>
          ) : (
            <EditWebsiteButton siteId={site.id} fallbackHref={site.editHref} />
          )}
        </div>
      </header>

      <div data-tour="site-tabs"><ScrollRail className="plx-hub__tabs" activeKey={currentHref} label="Site tabs">
        <TabLinks prefetch label="This site" current={currentHref} items={tabs.map((t) => ({ href: hubTabHref(site.id, t.id), label: t.label, tour: t.tour }))} />
      </ScrollRail></div>

      <div className="plx-hub__body">
        {experience === "beginner" ? <HelpMedia title={HELP[current]} caption="A short clip that shows exactly this step." /> : null}
        {children}
      </div>
    </div>
  );
}

/** A tab's heading row: title, one plain sentence, and the main action on the right. */
export function TabBar({ title, sub, action, titleAddon }: { title: string; sub?: string; action?: React.ReactNode; /** A small control beside the title (such as a help button). */ titleAddon?: React.ReactNode }) {
  return (
    <div className="plx-hub__bar">
      <div>
        <h2 className="plx-h2" style={titleAddon ? { display: "flex", alignItems: "center", gap: 10 } : undefined}>{title}{titleAddon}</h2>
        {sub ? <p className="plx-hub__sub">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}
