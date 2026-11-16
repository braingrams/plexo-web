"use client";

import "./hub.css";
import Link from "next/link";
import { ExternalLink, Plus, Eye } from "lucide-react";
import { Badge, Button, Card, EmptyState, StatusPill } from "../ui";
import { useOptionalNewSite } from "../../_components/NewSiteModal";
import type { HubSiteCard } from "@/lib/dashboardV3/hubData";

export function SitesList({ sites, experience, onCreate }: { sites: HubSiteCard[]; experience: string; onCreate?: () => void }) {
  const ctx = useOptionalNewSite();
  const create = onCreate ?? ctx?.openNewSite ?? (() => {});
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
      {sites.length === 0 ? (
        <EmptyState title="Make your first website" body="Pick what you want to make and we'll set it up with you." action={<Button leftIcon={<Plus size={18} aria-hidden />} onClick={create}>Create a website</Button>} />
      ) : (
        <div className="plx-hub__grid plx-hub__grid--wide">
          {sites.map((s) => (
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
              <div className="plx-sitecard__foot">
                <span className="plx-small" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Eye size={16} aria-hidden /> {s.visits7d} visit{s.visits7d === 1 ? "" : "s"} this week</span>
                {s.address ? (
                  <a href={`https://${s.address}`} target="_blank" rel="noreferrer" className="plx-btn plx-btn--ghost plx-btn--sm" style={{ position: "relative", zIndex: 1 }} aria-label={`Visit ${s.name}`}>
                    Visit <ExternalLink size={14} aria-hidden />
                  </a>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
