"use client";

import "./hub.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NEW_SITE_PATH } from "@/lib/dashboardV3/newSite";
import { ArrowRight, Plus, Eye } from "lucide-react";
import { OpenSiteIconButton, PreviewIconButton } from "../home/SiteButtons";
import { useState } from "react";
import { Badge, Button, Card, EmptyState, SegmentedControl, StatusPill } from "../ui";
import { SITE_FILTERS, filterSites, sitesListHref, type SiteFilter } from "@/lib/dashboardV3/siteFilter";
import { useOptionalNewSite } from "../../_components/NewSiteModal";
import type { HubSiteCard } from "@/lib/dashboardV3/hubData";

export function SitesList({ sites, experience, onCreate, initialFilter = "all" }: { sites: HubSiteCard[]; experience: string; onCreate?: () => void; initialFilter?: SiteFilter }) {
  const [filter, setFilter] = useState<SiteFilter>(initialFilter);
  const shown = filterSites(sites, filter);
  const pick = (f: SiteFilter) => {
    setFilter(f);
    try { window.history.replaceState(null, "", sitesListHref(f)); } catch { /* the filter still works without the address change */ }
  };
  const ctx = useOptionalNewSite();
  const router = useRouter();
  const create = onCreate ?? ctx?.openNewSite ?? (() => router.push(NEW_SITE_PATH));
  const add = <Button leftIcon={<Plus size={18} aria-hidden />} onClick={create} data-tour="sites-create">Create another website</Button>;
  return (
    <div className="plx-page plx-hub" data-tour="sites-main">
      <div className="plx-hub__bar">
        <div>
          <h1 className="plx-h1">{experience === "beginner" && sites.length < 2 ? "My website" : "My websites"}</h1>
          <p className="plx-hub__sub">Tap one to change it, see its visits, or add more to it.</p>
        </div>
        {sites.length ? add : null}
      </div>
      {sites.length > 1 && sites.some((x) => x.app) ? (
        <SegmentedControl label="Show" options={SITE_FILTERS} value={filter} onChange={pick} />
      ) : null}
      {sites.length === 0 ? (
        <EmptyState title="Make your first website" body="Pick what you want to make and we'll set it up with you." action={<Button leftIcon={<Plus size={18} aria-hidden />} onClick={create}>Create a website</Button>} />
      ) : shown.length === 0 ? (
        <EmptyState
          title={filter === "apps" ? "No apps yet" : "No websites yet"}
          body={filter === "apps" ? "An app is a site where people sign in and have their own account. Make one and we'll build it with you." : "Make a website and we'll set it up with you."}
          action={filter === "apps" ? <Button onClick={() => { window.location.href = "/dashboard/apps?create=1"; }} leftIcon={<Plus size={18} aria-hidden />}>Make an app</Button> : <Button leftIcon={<Plus size={18} aria-hidden />} onClick={create}>Create a website</Button>}
        />
      ) : (
        <div className="plx-hub__grid plx-hub__grid--wide">
          {shown.map((s) => (
            <Card key={s.id} as="article" className="plx-sitecard" style={{ position: "relative" }} interactive>
              <div className="plx-sitecard__top">
                <Badge tone="brand">{s.kind}</Badge>
                <StatusPill status={s.status} />
              </div>
              <h2 className="plx-sitecard__name">
                <Link href={`/dashboard/sites/${s.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                  <span style={{ position: "absolute", inset: 0, zIndex: 0 }} aria-hidden />
                  {s.name}
                </Link>
              </h2>
              <span className="plx-small" style={{ overflowWrap: "anywhere" }}>{s.address ?? "Not online yet"}</span>
              <span className="plx-small plx-sitecard__visits"><Eye size={16} aria-hidden /> {s.visits7d} visit{s.visits7d === 1 ? "" : "s"} this week</span>
              <div className="plx-sitecard__foot">
                <span className="plx-sitecard__manage">Manage <ArrowRight size={16} aria-hidden /></span>
                <span className="plx-sitecard__icons">
                  <PreviewIconButton site={s} />
                  <OpenSiteIconButton site={s} />
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
