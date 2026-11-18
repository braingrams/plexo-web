"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Home, MessagesSquare, Pencil, Trash2 } from "lucide-react";
import { Badge, Button, ButtonLink, Card, CardHeader, Input, Modal, useToast } from "../ui";
import type { HubPage } from "@/lib/dashboardV3/hubData";
import { cleanPathPart, deletePageMessage, movePage, orderedPages, pathProblem } from "@/lib/dashboardV3/hubView";
import { errMsg, hubApi } from "./hubApi";

type Menu = { available: boolean; hrefs: string[] };

/**
 * Rename, re-address, copy, reorder, hide from the menu and delete pages, in plain words. Wraps the same page APIs the
 * editor's Pages panel uses; up/down buttons do the reordering so it works with a keyboard and on a phone.
 */
export function ManagePagesList({ siteId, siteName, pages }: { siteId: string; siteName: string; pages: HubPage[] }) {
  const router = useRouter();
  const { show } = useToast();
  const rows = useMemo(() => orderedPages(pages), [pages]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ page: HubPage; name: string; slug: string } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [del, setDel] = useState<HubPage | null>(null);

  useEffect(() => {
    hubApi<Menu>(`/api/v1/sites/${siteId}/menu`).then(setMenu, () => setMenu({ available: false, hrefs: [] }));
  }, [siteId, pages.length]);

  async function act(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key);
    try {
      await fn();
      if (done) show({ title: done, tone: "success" });
      router.refresh();
    } catch (e) {
      show({ title: errMsg(e, "That didn't work. Please try again."), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  const move = (p: HubPage, dir: -1 | 1) => {
    const updates = movePage(pages, p.id, dir);
    if (!updates) return;
    void act(`move:${p.id}`, () => Promise.all(updates.map((u) => hubApi(`/api/templates/${u.id}`, { method: "PATCH", json: { order: u.order } }, "We couldn't move that page."))));
  };
  const copy = (p: HubPage) => act(`copy:${p.id}`, () => hubApi(`/api/templates/${p.id}/duplicate`, { method: "POST" }, "We couldn't copy that page."), `Copied "${p.name}"`);
  const toggleMenu = (p: HubPage, showIt: boolean) =>
    act(`menu:${p.id}`, async () => {
      const next = await hubApi<Menu>(`/api/v1/sites/${siteId}/menu`, { method: "PATCH", json: { href: p.path, label: p.name, show: showIt } }, "We couldn't change the menu.");
      setMenu(next);
    }, showIt ? `"${p.name}" is in your menu` : `"${p.name}" is out of your menu`);

  async function saveEdit() {
    if (!edit) return;
    const { page, name, slug } = edit;
    if (!name.trim()) return setEditError("Please give the page a name.");
    const siblings = pages.filter((p) => p.id !== page.id && !p.isRoot && p.parentId === page.parentId);
    if (!page.isRoot) {
      const problem = pathProblem(slug, siblings, page.slug);
      if (problem) return setEditError(problem);
    }
    setEditError(null);
    const body: Record<string, string> = {};
    if (name.trim() !== page.name) body.name = name.trim();
    if (!page.isRoot && cleanPathPart(slug) !== page.slug) body.slug = cleanPathPart(slug);
    if (!Object.keys(body).length) return setEdit(null);
    setBusy(`edit:${page.id}`);
    try {
      await hubApi(`/api/templates/${page.id}`, { method: "PATCH", json: body }, "We couldn't save those changes. Please try again.");
      show({ title: "Saved", tone: "success" });
      setEdit(null);
      router.refresh();
    } catch (e) {
      setEditError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const solHome = (p: HubPage) => `/dashboard/sol?new=1&draft=${encodeURIComponent(`Make "${p.name}" the home page of my site "${siteName}".`)}`;

  return (
    <>
      <ul className="plx-mp" aria-label="Your pages">
        {rows.map((p) => {
          const inMenu = menu?.available ? menu.hrefs.includes(p.path) : null;
          const working = busy?.endsWith(p.id) ?? false;
          return (
            <li key={p.id} className="plx-mp__row" style={{ paddingInlineStart: 12 + p.depth * 20 }}>
              <span className="plx-mp__main">
                <span className="plx-mp__name">
                  {p.isRoot ? <Home size={15} aria-hidden /> : null}
                  {p.name}
                </span>
                <span className="plx-mp__path">{p.isRoot ? "Home page" : p.path}</span>
              </span>
              <span className="plx-mp__badges">
                {!p.isPublished ? <Badge tone="warning">Draft</Badge> : null}
                {inMenu === false ? <Badge>Not in menu</Badge> : null}
              </span>
              <span className="plx-mp__acts">
                {!p.isRoot ? (
                  <>
                    <Button variant="ghost" size="sm" iconOnly aria-label={`Move ${p.name} up`} disabled={working || p.siblingIndex === 0} onClick={() => move(p, -1)}><ArrowUp size={18} aria-hidden /></Button>
                    <Button variant="ghost" size="sm" iconOnly aria-label={`Move ${p.name} down`} disabled={working || p.siblingIndex === p.siblingCount - 1} onClick={() => move(p, 1)}><ArrowDown size={18} aria-hidden /></Button>
                  </>
                ) : null}
                <Button variant="ghost" size="sm" iconOnly aria-label={`Change name or address of ${p.name}`} onClick={() => { setEditError(null); setEdit({ page: p, name: p.name, slug: p.slug ?? "" }); }}><Pencil size={18} aria-hidden /></Button>
                {!p.isRoot ? (
                  <>
                    {inMenu !== null ? (
                      <Button variant="ghost" size="sm" iconOnly aria-label={inMenu ? `Hide ${p.name} from the menu` : `Show ${p.name} in the menu`} aria-pressed={!inMenu} disabled={working} onClick={() => toggleMenu(p, !inMenu)}>{inMenu ? <Eye size={18} aria-hidden /> : <EyeOff size={18} aria-hidden />}</Button>
                    ) : null}
                    <Button variant="ghost" size="sm" iconOnly aria-label={`Make a copy of ${p.name}`} disabled={working} onClick={() => copy(p)}><Copy size={18} aria-hidden /></Button>
                    <Button variant="ghost" size="sm" iconOnly aria-label={`Delete ${p.name}`} style={{ color: "var(--plx-danger)" }} disabled={working} onClick={() => setDel(p)}><Trash2 size={18} aria-hidden /></Button>
                  </>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {menu && !menu.available ? <p className="plx-small" style={{ marginTop: 12 }}>This site&apos;s menu is set up in the design editor, so it can&apos;t be changed from here.</p> : null}

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title="Name and address"
        description="The address is what people type after your web address to reach this page."
        closeOnBackdrop={false}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={!!edit && busy === `edit:${edit.page.id}`} onClick={saveEdit}>Save</Button></>}
      >
        {edit ? (
          <div className="plx-form">
            <Input label="Page name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoComplete="off" />
            {edit.page.isRoot ? null : (
              <Input label="Page address" help={`Will be: ${edit.page.path.replace(/[^/]*$/, "")}${cleanPathPart(edit.slug) || "…"}`} value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} autoComplete="off" />
            )}
            {!edit.page.isRoot ? (
              <ButtonLink href={solHome(edit.page)} variant="link" size="sm" leftIcon={<MessagesSquare size={16} aria-hidden />}>Want this as your home page? Ask SOL</ButtonLink>
            ) : null}
            {editError ? <p className="plx-field__error" role="alert">{editError}</p> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!del}
        onClose={() => setDel(null)}
        title={del ? `Delete "${del.name}"?` : "Delete page"}
        description={del ? deletePageMessage(del.name, del.isRoot, pages.some((p) => p.parentId === del.id)) : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDel(null)}>Keep it</Button>
            <Button variant="danger" loading={!!del && busy === `del:${del.id}`} onClick={() => del && act(`del:${del.id}`, () => hubApi(`/api/templates/${del.id}`, { method: "DELETE" }, "We couldn't delete that page."), "Page deleted").then(() => setDel(null))}>Delete page</Button>
          </>
        }
      >
        <span />
      </Modal>
    </>
  );
}

/** For pros: the same tools, always there under the pages. */
export function ManagePagesCard({ siteId, siteName, pages }: { siteId: string; siteName: string; pages: HubPage[] }) {
  return (
    <Card data-tour="hub-manage-pages">
      <CardHeader title="Manage pages" description="Rename, reorder, copy, hide from the menu or delete." />
      <ManagePagesList siteId={siteId} siteName={siteName} pages={pages} />
    </Card>
  );
}
