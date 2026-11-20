"use client";

import "./hub.css";
import "./allsites.css";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Eye, Home, Pencil, Plus, Trash2, ExternalLink, Globe } from "lucide-react";
import { NEW_SITE_PATH } from "@/lib/dashboardV3/newSite";
import { onColour, siteColour, summaryLine } from "@/lib/dashboardV3/allSites";
import { CURRENT_SITE_COOKIE } from "@/lib/dashboardV3/sites";
import { liveHref, previewHref } from "@/lib/dashboardV3/siteLinks";
import { siteHubHref } from "@/lib/dashboardV3/hubPaths";
import type { SiteSummary } from "@/lib/dashboardV3/sites";
import type { Stat } from "@/lib/dashboardV3/homeData";
import { useOptionalNewSite } from "../../_components/NewSiteModal";
import { Button, ButtonLink } from "../ui";
import { Shot } from "./SitePicture";
import { DeleteSiteDialog, type DeletableSite } from "./DeleteSiteDialog";

export type BoardSite = { site: SiteSummary; stats: Stat[] };

function SiteTile({ row, isCurrent, onDelete }: { row: BoardSite; isCurrent?: boolean; onDelete: (s: DeletableSite) => void }) {
  const { site, stats } = row;
  const colour = siteColour(site.name, site.brand?.colors?.[0]);
  const ink = onColour(colour);
  const live = site.status === "live";

  const handleSwitchToHome = (e: React.MouseEvent) => {
    e.preventDefault();
    document.cookie = `${CURRENT_SITE_COOKIE}=${site.id}; path=/; max-age=31536000; SameSite=Lax`;
    window.location.href = "/dashboard";
  };

  return (
    <article className="plx-ab__tile" data-status={site.status} data-current={isCurrent ? "" : undefined} style={{ ["--ab-c" as string]: colour, ["--ab-ink" as string]: ink }}>
      <header className="plx-ab__top">
        <div className="plx-ab__titles">
          <h2 className="plx-ab__name" title={site.name}><Link href={siteHubHref(site.id)}>{site.name}</Link></h2>
          <span className="plx-ab__kind">{site.kind}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {isCurrent ? <span className="plx-ab__status" style={{ background: "var(--plx-brand)", color: "var(--plx-on-brand)" }}>Active on home</span> : null}
          <span className="plx-ab__status" data-live={live || undefined}>{live ? "Online" : "Not online yet"}</span>
        </div>
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
        <Button
          variant={isCurrent ? "secondary" : "strong"}
          size="sm"
          leftIcon={<Home size={14} aria-hidden />}
          onClick={handleSwitchToHome}
          title={isCurrent ? "Currently active on home" : "Show this site on home"}
        >
          {isCurrent ? "On home" : "Show on home"}
        </Button>
        <ButtonLink href={siteHubHref(site.id)} variant="secondary" size="sm" leftIcon={<Pencil size={14} aria-hidden />}>
          Edit
        </ButtonLink>
        {live ? (
          <ButtonLink href={liveHref(site) ?? "#"} variant="secondary" size="sm" rightIcon={<ExternalLink size={14} aria-hidden />} target="_blank" rel="noopener noreferrer">
            View
          </ButtonLink>
        ) : (
          <ButtonLink href={previewHref(site.id)} variant="secondary" size="sm" rightIcon={<ExternalLink size={14} aria-hidden />} target="_blank" rel="noopener noreferrer">
            Preview
          </ButtonLink>
        )}
        <Button variant="ghost" size="sm" iconOnly className="plx-ab__trash" title={`Delete ${site.name}`} aria-label={`Delete ${site.name}`} onClick={() => onDelete(site)}>
          <Trash2 size={16} aria-hidden />
        </Button>
      </div>
    </article>
  );
}

/** The colourful "all my sites" screen: a hero with the headline numbers, a big card per site, and a tile to make another. */
export function AllSitesBoard({ rows, homeName, currentSiteId }: { rows: BoardSite[]; homeName?: string | null; currentSiteId?: string | null }) {
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
          <Link href="/dashboard" className="plx-ab__back"><ArrowLeft size={16} aria-hidden /> Back to home</Link>
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
        {rows.map((r) => <SiteTile key={r.site.id} row={r} isCurrent={r.site.id === currentSiteId} onDelete={setDeleting} />)}
        <button type="button" className="plx-ab__new" onClick={create} data-tour="all-sites-create">
          <span className="plx-ab__plus"><Plus size={30} aria-hidden /></span>
          <b>Make another website</b>
          <span>Pick a look and we set it up with you.</span>
        </button>
      </div>
      <ButtonLink href="/dashboard" variant="secondary" leftIcon={<ArrowLeft size={18} aria-hidden />} style={{ alignSelf: "flex-start" }}>Back to home</ButtonLink>
      <DeleteSiteDialog site={deleting} onClose={() => setDeleting(null)} afterDelete={rows.length <= 1 ? "/dashboard" : "/dashboard/sites/all"} />
    </div>
  );
}
