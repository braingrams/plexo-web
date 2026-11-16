"use client";

import Link from "next/link";
import { useState } from "react";
import { FileText, ListOrdered, Plus } from "lucide-react";
import { Badge, Card, Modal } from "../ui";
import { pageNote } from "@/lib/dashboardV3/hubTabs";
import type { HubPage, HubSite } from "@/lib/dashboardV3/hubData";
import { TabBar } from "./HubFrame";
import { AddPageModal } from "./AddPageModal";
import { editHrefFor } from "@/lib/dashboardV3/hubPaths";
import { Button } from "../ui";
import { ManagePagesCard, ManagePagesList } from "./ManagePages";
import { managePagesMode } from "@/lib/dashboardV3/hubView";

function Thumb({ page }: { page: HubPage }) {
  const [state, setState] = useState<"loading" | "ok" | "broken">("loading");
  return (
    <div className="plx-pagecard__thumb" aria-hidden>
      {state !== "ok" ? (
        <div className="plx-pagecard__ph">
          <i />
          <i />
          <i style={{ width: "80%" }} />
          <i style={{ width: "65%" }} />
        </div>
      ) : null}
      {state !== "broken" ? (
        <img src={`/api/v1/templates/${page.id}/snapshot`} alt="" onLoad={() => setState("ok")} onError={() => setState("broken")} style={{ position: "absolute", inset: 0, opacity: state === "ok" ? 1 : 0 }} />
      ) : null}
    </div>
  );
}

export function PagesTab({ site, pages, experience }: { site: Pick<HubSite, "id" | "name" | "features" | "sourceType" | "designFormat">; pages: HubPage[]; experience: "beginner" | "intermediate" | "pro" }) {
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const always = managePagesMode(experience) === "always";
  const root = pages.find((p) => p.isRoot);
  return (
    <>
      <TabBar
        title="Your pages"
        sub={pages.length > 1 ? "Tap a page to change it." : "Your site starts with one page. Add more whenever you like."}
        action={
          <div className="plx-hub__actions">
            {!always && pages.length > 1 ? (
              <Button variant="secondary" leftIcon={<ListOrdered size={18} aria-hidden />} onClick={() => setManaging(true)} data-tour="hub-manage-pages">
                Manage pages
              </Button>
            ) : null}
            <Button leftIcon={<Plus size={18} aria-hidden />} onClick={() => setAdding(true)} data-tour="hub-add-page">
              Add a page
            </Button>
          </div>
        }
      />
      <div className="plx-hub__grid" data-tour="hub-pages">
        {pages.map((p) => {
          const note = pageNote({ slug: p.slug, isRoot: p.isRoot, isPublished: p.isPublished, archivedByPlan: p.archivedByPlan, storeOn: site.features.store, ownCode: p.sourceType === "RAW_UPLOAD" });
          return (
            <Card key={p.id} as="article" interactive padding="none" className="plx-pagecard" style={{ position: "relative" }}>
              <Thumb page={p} />
              <div className="plx-pagecard__body">
                <h3 className="plx-pagecard__name">
                  <Link href={editHrefFor(p.id, p.sourceType)} style={{ color: "inherit", textDecoration: "none" }}>
                    <span style={{ position: "absolute", inset: 0 }} aria-hidden />
                    {p.name}
                  </Link>
                </h3>
                <span className="plx-pagecard__path">{experience === "beginner" && p.isRoot ? "The first thing people see" : p.path}</span>
                {note ? (
                  <Badge className="plx-pagecard__note" tone={p.isPublished && !p.archivedByPlan ? (note === "Made for you" ? "info" : "neutral") : "warning"}>
                    {note}
                  </Badge>
                ) : null}
              </div>
            </Card>
          );
        })}
        <button type="button" className="plx-card plx-pagecard plx-pagecard--add" onClick={() => setAdding(true)}>
          <span className="plx-pagecard__plus">
            <Plus size={24} aria-hidden />
          </span>
          <span style={{ fontWeight: 800 }}>Add a page</span>
          <span className="plx-small">About us, Contact, Prices…</span>
        </button>
      </div>
      {always && pages.length > 0 ? <ManagePagesCard siteId={site.id} siteName={site.name} pages={pages} /> : null}
      <Modal open={managing} onClose={() => setManaging(false)} title="Manage pages" description="Rename, reorder, copy, hide from the menu or delete." width={640} footer={<Button onClick={() => setManaging(false)}>Done</Button>}>
        <ManagePagesList siteId={site.id} siteName={site.name} pages={pages} />
      </Modal>
      {pages.length === 0 ? (
        <p className="plx-body">
          <FileText size={16} aria-hidden style={{ verticalAlign: "-3px" }} /> We couldn&apos;t find any pages for this site yet.
        </p>
      ) : null}
      <AddPageModal open={adding} onClose={() => setAdding(false)} siteName={site.name} rootId={root?.id ?? site.id} pages={pages} isApp={site.features.app} siteIsClassic={site.designFormat !== "v2"} />
    </>
  );
}
