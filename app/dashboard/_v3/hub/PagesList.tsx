"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, Home, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { FREE_PAGE_LABEL, FreePageHelp } from "./FreePageHelp";
import { Badge, Button, Input, Modal, Select, useToast } from "../ui";
import type { HubPage } from "@/lib/dashboardV3/hubData";
import { deletePageMessage } from "@/lib/dashboardV3/hubView";
import { canEditAs, pageLabel, editViewHref, exactTime, filterPages, liveUrl, pageStatus, relativeTime, sortPages, type PageSort, type StatusFilter } from "@/lib/dashboardV3/pagesList";
import { errMsg, hubApi } from "./hubApi";

/** Pages are drawn this many at a time so a site with hundreds of pages stays quick. */
const CHUNK = 100;

/**
 * The Pages list: every page as a row (title, address, status, last changed) with the things people do to a page
 * right there. On a phone each row becomes a small card.
 */
export function PagesList({ siteId, address, pages, onAdd, freeLimited }: { siteId: string; address: string | null; pages: HubPage[]; onAdd?: () => void; /** Free plan: only the homepage is visible to visitors. */ freeLimited?: boolean }) {
  const router = useRouter();
  const { show } = useToast();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<PageSort>("updated-desc");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(CHUNK);
  const [menu, setMenu] = useState<string | null>(null);
  const [del, setDel] = useState<HubPage[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) return void (e.key === "Escape" && setMenu(null));
      if (!(e.target instanceof Node) || !wrap.current?.querySelector(`[data-menu="${menu}"]`)?.contains(e.target)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  const rows = useMemo(() => sortPages(filterPages(pages, query, status), sort), [pages, query, status, sort]);
  const visible = rows.slice(0, shown);
  const byId = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);
  const pickedPages = [...picked].map((id) => byId.get(id)).filter((p): p is HubPage => !!p);
  const pickable = visible.filter((p) => !p.isRoot);
  const allPicked = pickable.length > 0 && pickable.every((p) => picked.has(p.id));
  const now = Date.now();

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(key: string, targets: HubPage[], one: (p: HubPage) => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      for (const p of targets) await one(p);
      show({ title: done, tone: "success" });
      setPicked(new Set());
      router.refresh();
    } catch (e) {
      show({ title: errMsg(e, "That didn't work. Please try again."), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }
  const duplicate = (targets: HubPage[]) =>
    run("copy", targets, (p) => hubApi(`/api/templates/${p.id}/duplicate`, { method: "POST" }, `We couldn't copy "${pageLabel(p)}".`), targets.length === 1 ? `Copied "${targets[0].name}"` : `Copied ${targets.length} pages`);
  const remove = (targets: HubPage[]) =>
    run("del", targets, (p) => hubApi(`/api/templates/${p.id}`, { method: "DELETE" }, `We couldn't delete "${pageLabel(p)}".`), targets.length === 1 ? "Page deleted" : `${targets.length} pages deleted`).then(() => setDel(null));

  const delText = del
    ? del.length === 1
      ? deletePageMessage(del[0].name, del[0].isRoot, pages.some((p) => p.parentId === del[0].id))
      : `These ${del.length} pages will be deleted for good, along with any pages inside them. Your visitors will no longer find them.`
    : undefined;

  return (
    <div className="plx-pl" ref={wrap}>
      <div className="plx-pl__bar">
        <Input label="Search pages" hideLabel type="search" placeholder="Search by name or address" value={query} onChange={(e) => { setQuery(e.target.value); setShown(CHUNK); }} fieldClassName="plx-pl__search" autoComplete="off" />
        <Select label="Show" hideLabel value={status} onChange={(e) => { setStatus(e.target.value as StatusFilter); setShown(CHUNK); }} options={[{ value: "all", label: "All pages" }, { value: "published", label: "Published" }, { value: "draft", label: "Drafts" }]} />
        <Select label="Sort by" hideLabel value={sort} onChange={(e) => setSort(e.target.value as PageSort)} options={[{ value: "updated-desc", label: "Newest changes first" }, { value: "updated-asc", label: "Oldest changes first" }, { value: "title-asc", label: "Name A to Z" }, { value: "title-desc", label: "Name Z to A" }]} />
      </div>

      {picked.size > 0 ? (
        <div className="plx-pl__bulk" role="region" aria-label="Actions for selected pages">
          <strong>{picked.size} selected</strong>
          <Button variant="secondary" size="sm" leftIcon={<Copy size={16} aria-hidden />} loading={busy === "copy"} onClick={() => duplicate(pickedPages)}>Make copies</Button>
          <Button variant="danger" size="sm" leftIcon={<Trash2 size={16} aria-hidden />} onClick={() => setDel(pickedPages)}>Delete</Button>
          <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>Clear</Button>
        </div>
      ) : null}

      <div className="plx-pl__table" role="table" aria-label="Your pages">
        <div className="plx-pl__head" role="row">
          <span role="columnheader">
            <input type="checkbox" aria-label="Select all pages shown" checked={allPicked} disabled={pickable.length === 0} onChange={() => setPicked(allPicked ? new Set() : new Set(pickable.map((p) => p.id)))} />
          </span>
          <span role="columnheader">Page</span>
          <span role="columnheader">Address</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Last changed</span>
          <span role="columnheader" className="plx-pl__headacts">Actions</span>
        </div>
        {visible.map((p) => {
          const st = pageStatus(p);
          const live = st === "published" ? liveUrl(address, p.path) : null;
          const working = busy !== null && picked.has(p.id);
          return (
            <div key={p.id} className="plx-pl__row" role="row" data-selected={picked.has(p.id) || undefined}>
              <span role="cell" className="plx-pl__check">
                <input type="checkbox" aria-label={`Select ${pageLabel(p)}`} checked={picked.has(p.id)} disabled={p.isRoot} title={p.isRoot ? "The home page can't be copied or deleted here" : undefined} onChange={() => toggle(p.id)} />
              </span>
              <span role="cell" className="plx-pl__title">
                <Link href={editViewHref(p.id, p.sourceType, "design")}>
                  {p.isRoot ? <Home size={15} aria-hidden /> : null}
                  {pageLabel(p)}
                </Link>
              </span>
              <span role="cell" className="plx-pl__path">{p.isRoot ? "/ (home page)" : p.path}</span>
              <span role="cell">
                {freeLimited && !p.isRoot ? <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}><Badge tone="warning">{FREE_PAGE_LABEL}</Badge><FreePageHelp /></span> : st === "published" ? <Badge tone="success" dot>Published</Badge> : <Badge tone="warning">{p.archivedByPlan ? "Not live (plan)" : "Draft"}</Badge>}
              </span>
              <span role="cell" className="plx-pl__when" title={exactTime(p.updatedAt)}>{relativeTime(p.updatedAt, now)}</span>
              <span role="cell" className="plx-pl__acts" data-menu={p.id}>
                <Button variant="secondary" size="sm" leftIcon={<Pencil size={16} aria-hidden />} onClick={() => router.push(editViewHref(p.id, p.sourceType, "design"))}>Edit</Button>
                <Button variant="ghost" size="sm" iconOnly aria-label={`More actions for ${pageLabel(p)}`} aria-haspopup="menu" aria-expanded={menu === p.id} disabled={working} onClick={() => setMenu(menu === p.id ? null : p.id)}>
                  <MoreHorizontal size={18} aria-hidden />
                </Button>
                {menu === p.id ? (
                  <div className="plx-pl__menu" role="menu">
                    {canEditAs(p.sourceType, "code") ? (
                      <Link role="menuitem" href={editViewHref(p.id, p.sourceType, "code")}>Edit the code</Link>
                    ) : null}
                    {canEditAs(p.sourceType, "text") ? (
                      <Link role="menuitem" href={editViewHref(p.id, p.sourceType, "text")}>Edit the words</Link>
                    ) : null}
                    {live ? (
                      <a role="menuitem" href={live} target="_blank" rel="noreferrer">
                        View page <ExternalLink size={14} aria-hidden />
                      </a>
                    ) : null}
                    {!p.isRoot ? (
                      <>
                        <button type="button" role="menuitem" onClick={() => { setMenu(null); void duplicate([p]); }}>Make a copy</button>
                        <button type="button" role="menuitem" className="plx-pl__danger" onClick={() => { setMenu(null); setDel([p]); }}>Delete…</button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </span>
            </div>
          );
        })}
        {onAdd ? (
          <button type="button" className="plx-pl__add" onClick={onAdd}>
            <Plus size={18} aria-hidden /> Add a page <span className="plx-small">About us, Contact, Prices…</span>
          </button>
        ) : null}
        {rows.length === 0 ? (
          <p className="plx-pl__empty">{pages.length === 0 ? "No pages yet." : "No pages match. Try a different word, or show all pages."}</p>
        ) : null}
      </div>

      {rows.length > shown ? (
        <div className="plx-pl__more">
          <Button variant="secondary" onClick={() => setShown(shown + CHUNK)}>Show more pages ({rows.length - shown} left)</Button>
        </div>
      ) : null}
      <p className="plx-small plx-pl__count">{rows.length === pages.length ? `${pages.length} ${pages.length === 1 ? "page" : "pages"}` : `${rows.length} of ${pages.length} pages`}</p>

      <Modal
        open={!!del}
        onClose={() => setDel(null)}
        title={del ? (del.length === 1 ? `Delete "${del[0].name}"?` : `Delete ${del.length} pages?`) : "Delete page"}
        description={delText}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDel(null)}>Keep {del && del.length > 1 ? "them" : "it"}</Button>
            <Button variant="danger" loading={busy === "del"} onClick={() => del && void remove(del)}>{del && del.length > 1 ? "Delete pages" : "Delete page"}</Button>
          </>
        }
      >
        <span />
      </Modal>
    </div>
  );
}
