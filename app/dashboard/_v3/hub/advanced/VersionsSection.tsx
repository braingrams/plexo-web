"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Skeleton, useToast } from "../../ui";
import { errMsg, hubApi } from "../hubApi";
import { PagePicker, usePages } from "./PagePicker";

type Revision = { id: string; createdAt: string; authorName: string; isActive: boolean };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Every saved version of a page, and going back to one. */
export function VersionsSection({ siteId }: { siteId: string }) {
  const { show } = useToast();
  const router = useRouter();
  const { pages } = usePages(siteId);
  const [pageId, setPageId] = useState<string | null>(null);
  const [list, setList] = useState<Revision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (pages?.length) setPageId((p) => p ?? pages[0].id); }, [pages]);

  const load = useCallback(async (id: string) => {
    setList(null);
    setError(null);
    try {
      const d = await hubApi<{ revisions: Revision[] }>(`/api/templates/${id}/revisions`, undefined, "We couldn't load the versions.");
      setList(d.revisions ?? []);
    } catch (e) {
      setError(errMsg(e));
      setList([]);
    }
  }, []);
  useEffect(() => { if (pageId) void load(pageId); }, [pageId, load]);

  async function restore(r: Revision) {
    if (!pageId || !window.confirm(`Go back to the version from ${when(r.createdAt)}? What is on the page now is replaced.`)) return;
    setBusy(r.id);
    try {
      await hubApi(`/api/templates/${pageId}/restore/${r.id}`, { method: "POST" }, "We couldn't go back to that version.");
      show({ title: "Went back to that version", tone: "success" });
      await load(pageId);
      router.refresh();
    } catch (e) {
      show({ title: errMsg(e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }
  async function remove(r: Revision) {
    if (!pageId || !window.confirm("Delete this saved version? You can't get it back.")) return;
    setBusy(r.id);
    try {
      await hubApi(`/api/templates/${pageId}/revisions/${r.id}`, { method: "DELETE" }, "We couldn't delete that version.");
      setList((l) => l?.filter((x) => x.id !== r.id) ?? l);
    } catch (e) {
      show({ title: errMsg(e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="plx-adv__stack">
      {pages && pageId ? <div className="plx-adv__pick"><PagePicker pages={pages} value={pageId} onChange={setPageId} /></div> : null}
      <Card>
        <CardHeader title="Saved versions" description="A version is saved each time the page goes live." />
        {list === null ? (
          <div className="plx-form"><Skeleton height={48} /><Skeleton height={48} /></div>
        ) : error ? (
          <p className="plx-field__error" role="alert">{error}</p>
        ) : list.length === 0 ? (
          <EmptyState compact title="No saved versions yet" body="When you make this page live, its first version is saved here." />
        ) : (
          <div>
            {list.map((r) => (
              <div key={r.id} className="plx-adv__ver">
                <div className="plx-adv__grow" style={{ flex: "1 1 200px", display: "flex", flexDirection: "column" }}>
                  <b style={{ fontSize: 15 }}>{when(r.createdAt)}</b>
                  <span className="plx-small">Saved by {r.authorName || "someone on your team"}</span>
                </div>
                {r.isActive ? <Badge tone="success">Live now</Badge> : null}
                {!r.isActive ? <Button variant="secondary" leftIcon={<RotateCcw size={16} aria-hidden />} loading={busy === r.id} onClick={() => restore(r)}>Go back to this</Button> : null}
                {!r.isActive ? <Button variant="ghost" iconOnly aria-label="Delete this version" disabled={busy === r.id} onClick={() => remove(r)}><Trash2 size={18} aria-hidden /></Button> : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
