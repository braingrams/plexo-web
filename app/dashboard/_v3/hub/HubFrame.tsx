"use client";

import "./hub.css";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Pencil, Upload } from "lucide-react";
import { Badge, ButtonLink, HelpMedia, StatusPill, TabLinks } from "../ui";
import { hubTabHref, type HubTab, type HubTabId } from "@/lib/dashboardV3/hubTabs";
import type { Experience } from "@/lib/dashboardV3/nav";
import type { HubSite } from "@/lib/dashboardV3/hubData";

export type HubFrameSite = Pick<HubSite, "id" | "name" | "kind" | "status" | "address" | "editHref" | "sourceType" | "designFormat"> & { deployed?: "server" | "static" | null };

const HELP: Record<HubTabId, string> = {
  app: "How to update your app",
  pages: "How to add and change pages",
  products: "How to add a product",
  orders: "How to handle an order",
  blog: "How to write a blog post",
  course: "How to add a lesson",
  brand: "How to change your colours and logo",
  address: "How to choose your web address",
  visits: "How to read your visits",
  settings: "How to change your site's settings",
};

export function builderLabel(site: Pick<HubFrameSite, "sourceType" | "designFormat"> & { deployed?: "server" | "static" | null }): string {
  if (site.deployed === "server") return "Your own server code";
  if (site.deployed === "static") return "Your own app files";
  if (site.sourceType === "REACT_PROJECT") return "App builder";
  if (site.sourceType === "RAW_UPLOAD") return "Your own code";
  return site.designFormat === "v2" ? "Visual editor" : "Visual editor (classic)";
}

/** The top of a site's hub: who it is, whether it's live, the two main buttons, and only the tabs it uses. */
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
          {site.address ? (
            <ButtonLink href={`https://${site.address}`} target="_blank" rel="noreferrer" variant="secondary" rightIcon={<ExternalLink size={16} aria-hidden />}>
              Visit site
            </ButtonLink>
          ) : null}
          {site.deployed ? (
            <ButtonLink href={hubTabHref(site.id, "app")} leftIcon={<Upload size={16} aria-hidden />}>
              Update app
            </ButtonLink>
          ) : (
            <ButtonLink href={site.editHref} leftIcon={<Pencil size={16} aria-hidden />}>
              Edit design
            </ButtonLink>
          )}
        </div>
      </header>

      <div data-tour="site-tabs" className="plx-hub__tabs">
        <TabLinks label="This site" current={currentHref} items={tabs.map((t) => ({ href: hubTabHref(site.id, t.id), label: t.label, tour: t.tour }))} />
      </div>

      <div className="plx-hub__body">
        {experience === "beginner" ? <HelpMedia title={HELP[current]} caption="A short clip that shows exactly this step." /> : null}
        {children}
      </div>
    </div>
  );
}

/** A tab's heading row: title, one plain sentence, and the main action on the right. */
export function TabBar({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="plx-hub__bar">
      <div>
        <h2 className="plx-h2">{title}</h2>
        {sub ? <p className="plx-hub__sub">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}
