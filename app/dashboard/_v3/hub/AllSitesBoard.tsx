"use client";

import "./hub.css";
import "./allsites.css";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Eye, Pencil, Plus, Share2, ShoppingBag, Package, Trash2, PenLine, GraduationCap, ExternalLink, Globe } from "lucide-react";
import { NEW_SITE_PATH } from "@/lib/dashboardV3/newSite";
import { cardActions, onColour, siteColour, summaryLine, type CardAction } from "@/lib/dashboardV3/allSites";
import { liveHref, previewHref } from "@/lib/dashboardV3/siteLinks";
import { siteHubHref } from "@/lib/dashboardV3/hubPaths";
import type { SiteSummary } from "@/lib/dashboardV3/sites";
import type { Stat } from "@/lib/dashboardV3/homeData";
import { useOptionalNewSite } from "../../_components/NewSiteModal";
import { Button, ButtonLink } from "../ui";
import { Shot } from "./SitePicture";
import { DeleteSiteDialog, type DeletableSite } from "./DeleteSiteDialog";

export type BoardSite = { site: SiteSummary; stats: Stat[] };

function ShareButton({ site }: { site: SiteSummary }) {
  const [copied, setCopied] = useState(false);
  const url = liveHref(site);
  if (!url) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      leftIcon={copied ? <Check size={16} aria-hidden /> : <Share2 size={16} aria-hidden />}
      onClick={async () => {
        try {
          if (typeof navigator.share === "function") await navigator.share({ title: site.name, url });
          else {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2500);
          }
        } catch (e) {
          if ((e as { name?: string })?.name === "AbortError") return; // they closed the share sheet
          window.prompt("Copy your link", url);
        }
      }}
    >
      {copied ? "Link copied" : "Share"}
    </Button>
  );
}

const ICON: Record<CardAction["id"], React.ReactNode> = {
  edit: <Pencil size={16} aria-hidden />,
  view: <Eye size={16} aria-hidden />,
  share: <Share2 size={16} aria-hidden />,
  product: <Package size={16} aria-hidden />,
  orders: <ShoppingBag size={16} aria-hidden />,
  post: <PenLine size={16} aria-hidden />,
  lessons: <GraduationCap size={16} aria-hidden />,
};

function SiteTile({ row, onDelete }: { row: BoardSite; onDelete: (s: DeletableSite) => void }) {
  const { site, stats } = row;
  const colour = siteColour(site.name, site.brand?.colors?.[0]);
  const ink = onColour(colour);
  const live = site.status === "live";
  const actions = cardActions(
    { id: site.id, kind: site.kind, status: site.status, address: site.address },
    { edit: siteHubHref(site.id), preview: previewHref(site.id), live: liveHref(site), product: siteHubHref(site.id, "products"), orders: siteHubHref(site.id, "orders"), post: siteHubHref(site.id, "blog"), lessons: siteHubHref(site.id, "course") },
  );
  return (
    <article className="plx-ab__tile" data-status={site.status} style={{ ["--ab-c" as string]: colour, ["--ab-ink" as string]: ink }}>
      <header className="plx-ab__top">
        <div className="plx-ab__titles">
          <h2 className="plx-ab__name"><Link href={siteHubHref(site.id)}>{site.name}</Link></h2>
          <span className="plx-ab__kind">{site.kind}</span>
        </div>
        <span className="plx-ab__status" data-live={live || undefined}>{live ? "Online" : "Not online yet"}</span>
      </header>
      <Shot id={site.id} colour={colour} />
      {stats.length ? (
        <dl className="plx-ab__stats">
          {stats.slice(0, 3).map((s) => (
            <div key={s.id}>
              <dd>{s.value}</dd>
              <dt>{s.label}</dt>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="plx-ab__addr">
        <Globe size={14} aria-hidden /> {site.address ?? "No web address yet"}
      </p>
      <div className="plx-ab__acts">
        {actions.map((a) =>
          a.id === "share" ? (
            <ShareButton key="share" site={site} />
          ) : (
            <ButtonLink key={a.id} href={a.href ?? "#"} variant={a.id === "edit" ? "strong" : "secondary"} size="sm" leftIcon={ICON[a.id]} rightIcon={a.external ? <ExternalLink size={14} aria-hidden /> : undefined} {...(a.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
              {a.label}
            </ButtonLink>
          ),
        )}
        <Button variant="ghost" size="sm" iconOnly className="plx-ab__trash" title={`Delete ${site.name}`} aria-label={`Delete ${site.name}`} onClick={() => onDelete(site)}>
          <Trash2 size={16} aria-hidden />
        </Button>
      </div>
    </article>
  );
}

/** The colourful "all my sites" screen: a hero with the headline numbers, a big card per site, and a tile to make another. */
export function AllSitesBoard({ rows, homeName }: { rows: BoardSite[]; /** The site the owner was working on: "Back to {name} home". */ homeName?: string | null }) {
  const router = useRouter();
  const ctx = useOptionalNewSite();
  const create = ctx?.openNewSite ?? (() => router.push(NEW_SITE_PATH));
  const [deleting, setDeleting] = useState<DeletableSite | null>(null);
  const live = rows.filter((r) => r.site.status === "live").length;
  const visits = rows.reduce((n, r) => n + Number(r.stats.find((s) => s.id === "visits")?.value.replace(/\D/g, "") || 0), 0);
  return (
    <div className="plx-page plx-ab" data-tour="all-sites-board">
      <section className="plx-ab__hero">
        <div>
          <Link href="/dashboard" className="plx-ab__back"><ArrowLeft size={16} aria-hidden /> {homeName ? `Back to ${homeName} home` : "Back to home"}</Link>
          <h1 className="plx-ab__h1">All my sites</h1>
          <p className="plx-ab__sum">{summaryLine(rows.length, live)}</p>
        </div>
        <div className="plx-ab__nums">
          <div><b>{rows.length}</b><span>{rows.length === 1 ? "Site" : "Sites"}</span></div>
          <div><b>{live}</b><span>Online</span></div>
          <div><b>{visits.toLocaleString("en")}</b><span>Visits this week</span></div>
        </div>
      </section>
      <div className="plx-ab__grid">
        {rows.map((r) => <SiteTile key={r.site.id} row={r} onDelete={setDeleting} />)}
        <button type="button" className="plx-ab__new" onClick={create} data-tour="all-sites-create">
          <span className="plx-ab__plus"><Plus size={30} aria-hidden /></span>
          <b>Make another website</b>
          <span>Pick a look and we set it up with you.</span>
        </button>
      </div>
      <ButtonLink href="/dashboard" variant="secondary" leftIcon={<ArrowLeft size={18} aria-hidden />} style={{ alignSelf: "flex-start" }}>{homeName ? `Back to ${homeName} home` : "Back to home"}</ButtonLink>
      <DeleteSiteDialog site={deleting} onClose={() => setDeleting(null)} afterDelete={rows.length <= 1 ? "/dashboard" : "/dashboard/sites/all"} />
    </div>
  );
}
