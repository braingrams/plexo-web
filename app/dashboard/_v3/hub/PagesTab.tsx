"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FileText, LayoutGrid, List, ListOrdered, MoreHorizontal, Plus } from "lucide-react";
import { Badge, Card, EmptyState, Modal, SegmentedControl } from "../ui";
import { PagesList } from "./PagesList";
import { pageLabel, readPagesView, savePagesView, type PagesViewMode } from "@/lib/dashboardV3/pagesList";
import { pageNote } from "@/lib/dashboardV3/hubTabs";
import type { HubPage, HubSite } from "@/lib/dashboardV3/hubData";
import { SolIcon } from "../../sol/_components/SolIcon";
import { MultiPageSolDialog } from "../../_components/MultiPageSolDialog";
import { useRouter } from "next/navigation";
import { TabBar } from "./HubFrame";
import { AddPageModal } from "./AddPageModal";
import { editHrefFor } from "@/lib/dashboardV3/hubPaths";
import { FREE_PAGE_LABEL, FreePageHelp } from "./FreePageHelp";
import { UpgradePrompt } from "@/app/dashboard/_components/UpgradePrompt";
import { Button } from "../ui";
import { ManagePagesCard, ManagePagesList } from "./ManagePages";
import { managePagesMode } from "@/lib/dashboardV3/hubView";

const THUMB_W = 1280;

/**
 * A real picture of the page: its own working copy shown small and inert (not clickable, no scripts). The tidy sketch sits
 * underneath and only shows when the page is still empty. Pictures load as the card scrolls into view.
 */
function Thumb({ page, siteId }: { page: HubPage; siteId: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.22);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / THUMB_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  let h = 0;
  for (const c of page.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const layout = page.isRoot ? 0 : (h % 3) + 1;
  const src = `/api/v1/templates/${siteId}/draft-preview?thumb=1${page.isRoot ? "" : `&page=${page.id}`}`;
  // Only show the real picture when it loads. If it can't (offline, error), the tidy sketch stays: never an error page.
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let off = false;
    fetch(src).then((r) => !off && setOk(r.ok && (r.headers.get("content-type") ?? "").includes("text/html"))).catch(() => undefined);
    return () => { off = true; };
  }, [src]);
  return (
    <div className="plx-pagecard__thumb" ref={box} aria-hidden>
      <div className={`plx-sketch plx-sketch--${layout}`}>
        <div className="plx-sketch__bar"><i /><i /><i /></div>
        <div className="plx-sketch__body">
          <b className="plx-sketch__hero" />
          <i className="plx-sketch__line" />
          <i className="plx-sketch__line plx-sketch__line--s" />
          <div className="plx-sketch__cells"><u /><u /><u /></div>
        </div>
      </div>
      {page.sourceType !== "REACT_PROJECT" && ok ? (
        <iframe className="plx-pagecard__shot" src={src} title="" tabIndex={-1} loading="lazy" referrerPolicy="no-referrer" style={{ width: THUMB_W, height: Math.round((THUMB_W * 10) / 16), transform: `scale(${scale})` }} />
      ) : null}
    </div>
  );
}

export function PagesTab({ site, pages, experience, plan }: { /** The owner's plan: on Free only the homepage is visible to visitors, and every other page says so. */ plan?: string; site: Pick<HubSite, "id" | "name" | "address" | "features" | "sourceType" | "designFormat">; pages: HubPage[]; experience: "beginner" | "intermediate" | "pro" }) {
  const router = useRouter();
  const freeLimited = plan === "FREE" && pages.some((p) => !p.isRoot);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [askingSol, setAskingSol] = useState(false);
  const [view, setView] = useState<PagesViewMode>("cards");
  useEffect(() => setView(readPagesView()), []);
  const changeView = (v: PagesViewMode) => {
    setView(v);
    savePagesView(v);
  };
  const always = managePagesMode(experience) === "always";
  const [more, setMore] = useState(false);
  const moreBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more) return;
    const down = (e: MouseEvent) => { if (moreBox.current && !moreBox.current.contains(e.target as Node)) setMore(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setMore(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [more]);
  const canManage = !always && pages.length > 1;
  const canSol = pages.length > 1 && site.sourceType !== "REACT_PROJECT";
  const root = pages.find((p) => p.isRoot);
  return (
    <>
      <TabBar
        title="Your pages"
        sub={pages.length > 1 ? "Tap a page to change it." : "Your site starts with one page. Add more whenever you like."}
        action={
          <div className="plx-hub__actions">
            {pages.length > 1 ? (
              <SegmentedControl<PagesViewMode>
                label="How to show your pages"
                value={view}
                onChange={changeView}
                options={[
                  { value: "cards", label: "Grid", icon: <LayoutGrid size={16} aria-hidden /> },
                  { value: "list", label: "List", icon: <List size={16} aria-hidden /> },
                ]}
              />
            ) : null}
            <div className="plx-pgmore" ref={moreBox}>
                <Button variant="secondary" leftIcon={<MoreHorizontal size={18} aria-hidden />} aria-haspopup="menu" aria-expanded={more} onClick={() => setMore((m) => !m)} data-tour="hub-add-page">
                  More
                </Button>
                {more ? (
                  <div className="plx-pgmore__menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => { setMore(false); setAdding(true); }}>
                      <Plus size={18} aria-hidden /> Add a page
                    </button>
                    {canManage ? (
                      <button type="button" role="menuitem" onClick={() => { setMore(false); setManaging(true); }}>
                        <ListOrdered size={18} aria-hidden /> Manage pages
                      </button>
                    ) : null}
                    {canSol ? (
                      <button type="button" role="menuitem" onClick={() => { setMore(false); setAskingSol(true); }}>
                        <SolIcon size={18} /> Change several pages with SOL
                      </button>
                    ) : null}
                  </div>
                ) : null}
            </div>
          </div>
        }
      />
      {freeLimited ? (
        <UpgradePrompt
          message={`You're on the Free plan, so visitors only see your homepage. Your other ${pages.filter((p) => !p.isRoot).length === 1 ? "page is" : `${pages.filter((p) => !p.isRoot).length} pages are`} saved, but not shown to visitors until you upgrade.`}
          requiredPlan="STARTER"
          returnTo={`/dashboard/sites/${site.id}`}
          tone="info"
        />
      ) : null}
      {view === "list" && pages.length > 1 ? (
        <div data-tour="hub-pages">
          <PagesList siteId={site.id} address={site.address} pages={pages} onAdd={() => setAdding(true)} freeLimited={freeLimited} />
        </div>
      ) : (
      <div className="plx-hub__grid" data-tour="hub-pages">
        {pages.map((p) => {
          const note = pageNote({ slug: p.slug, isRoot: p.isRoot, isPublished: p.isPublished, archivedByPlan: p.archivedByPlan, storeOn: site.features.store, ownCode: p.sourceType === "RAW_UPLOAD" });
          return (
            <Card key={p.id} as="article" interactive padding="none" className="plx-pagecard" style={{ position: "relative" }}>
              <Thumb page={p} siteId={site.id} />
              <div className="plx-pagecard__body">
                <h3 className="plx-pagecard__name">
                  <Link href={editHrefFor(p.id, p.sourceType)} style={{ color: "inherit", textDecoration: "none" }}>
                    <span style={{ position: "absolute", inset: 0 }} aria-hidden />
                    {pageLabel(p)}
                  </Link>
                </h3>
                <span className="plx-pagecard__path">{experience === "beginner" && p.isRoot ? "The first thing people see" : p.path}</span>
                {freeLimited && !p.isRoot ? (
                  <span style={{ display: "flex", alignItems: "flex-start", gap: 2, position: "relative", zIndex: 1, maxWidth: "100%", minWidth: 0 }}>
                    <Badge className="plx-pagecard__note" tone="warning">{FREE_PAGE_LABEL}</Badge>
                    <FreePageHelp />
                  </span>
                ) : note ? (
                  <Badge className="plx-pagecard__note" tone={p.isPublished && !p.archivedByPlan ? "neutral" : "warning"}>
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
      )}
      {always && pages.length > 0 ? <ManagePagesCard siteId={site.id} siteName={site.name} pages={pages} /> : null}
      {askingSol && <MultiPageSolDialog siteId={site.id} onClose={() => setAskingSol(false)} onChanged={() => router.refresh()} />}
      <Modal open={managing} onClose={() => setManaging(false)} title="Manage pages" description="Rename, reorder, copy, hide from the menu or delete." width={640} footer={<Button onClick={() => setManaging(false)}>Done</Button>}>
        <ManagePagesList siteId={site.id} siteName={site.name} pages={pages} />
      </Modal>
      {pages.length === 0 ? (
        <EmptyState
          title="Add your first page"
          body="Pages are the parts of your site, like Home, About or Contact. Start with one and add more any time."
          action={<Button onClick={() => setAdding(true)}>Add a page</Button>}
        />
      ) : null}
      <AddPageModal open={adding} onClose={() => setAdding(false)} siteName={site.name} rootId={root?.id ?? site.id} pages={pages} isApp={site.features.app} siteIsClassic={site.designFormat !== "v2"} />
    </>
  );
}
