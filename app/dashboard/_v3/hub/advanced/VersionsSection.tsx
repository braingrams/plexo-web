"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { History, RotateCcw, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Modal, Notice, OptimisticLoader, Skeleton, useToast } from "../../ui";
import type { RestoreDay } from "@/lib/siteRestorePoints";
import { errMsg, hubApi } from "../hubApi";
import { PagePicker, usePages } from "./PagePicker";

type Revision = { id: string; createdAt: string; authorName: string; isActive: boolean };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** The whole site, day by day: pick a day and every page goes back to how it was at the end of it. */
function SiteDays({ siteId }: { siteId: string }) {
  const { show } = useToast();
  const router = useRouter();
  const tz = new Date().getTimezoneOffset();
  const base = `/api/v1/templates/${siteId}/restore-points`;
  const [days, setDays] = useState<RestoreDay[] | null>(null);
  const [pick, setPick] = useState<{ day: string; will: string[]; untouched: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    hubApi<{ days: RestoreDay[] }>(`${base}?tz=${tz}`).then((d) => setDays(d.days)).catch(() => setDays([]));
  }, [base, tz]);

  async function preview(day: string) {
    setBusy(day);
    try {
      const d = await hubApi<{ willRestore: string[]; untouched: string[] }>(base, { method: "POST", json: { day, tz, dryRun: true } }, "We couldn't check that day.");
      setPick({ day, will: d.willRestore, untouched: d.untouched });
    } catch (e) {
      show({ title: errMsg(e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }
  async function confirm() {
    if (!pick) return;
    setSaving(true);
    try {
      const d = await hubApi<{ restored: number }>(base, { method: "POST", json: { day: pick.day, tz } }, "We couldn't go back to that day.");
      show({ title: d.restored ? `Your site is back to ${dayLabel(pick.day)}` : "Your site already looks like that", tone: "success" });
      setPick(null);
      router.refresh();
    } catch (e) {
      show({ title: errMsg(e), tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Your site, day by day" description="Made a mess? Pick a day and your whole site goes back to how it was at the end of it. Every page, in one go." />
      {days === null ? (
        <Skeleton height={64} />
      ) : days.length === 0 ? (
        <EmptyState compact title="Nothing to go back to yet" body="A day shows up here after you make something live. Your first one appears the next time you publish." />
      ) : (
        <div>
          {days.slice(0, 30).map((d) => (
            <div key={d.day} className="plx-adv__ver">
              <div className="plx-adv__grow" style={{ flex: "1 1 200px", display: "flex", flexDirection: "column" }}>
                <b style={{ fontSize: 15 }}>{dayLabel(d.day)}</b>
                <span className="plx-small">{d.publishes} {d.publishes === 1 ? "change" : "changes"} made live on {d.pages} {d.pages === 1 ? "page" : "pages"}</span>
              </div>
              <Button variant="secondary" leftIcon={<History size={16} aria-hidden />} loading={busy === d.day} onClick={() => void preview(d.day)}>Put my site back to this day</Button>
            </div>
          ))}
        </div>
      )}
      <Modal open={pick !== null} onClose={() => !saving && setPick(null)} title={pick ? `Go back to ${dayLabel(pick.day)}?` : ""} footer={<><Button variant="secondary" disabled={saving} onClick={() => setPick(null)}>Cancel</Button><Button loading={saving} disabled={!pick?.will.length} onClick={() => void confirm()}>Go back to this day</Button></>}>
        {pick ? (
          <div className="plx-adv__stack">
            {pick.will.length === 0 ? (
              <Notice kind="success" title="Nothing to change">Your site already looks the way it did at the end of that day.</Notice>
            ) : (
              <>
                <p className="plx-body" style={{ margin: 0 }}>These {pick.will.length === 1 ? "page goes" : `${pick.will.length} pages go`} back to how {pick.will.length === 1 ? "it" : "they"} looked then: <b>{pick.will.join(", ")}</b>.</p>
                <Notice kind="info" title="You can undo this">The versions you have now stay saved, so you can come back to them from this list.</Notice>
              </>
            )}
            {pick.untouched.length ? <p className="plx-small" style={{ margin: 0 }}>{pick.untouched.join(", ")} did not exist yet, so {pick.untouched.length === 1 ? "it stays" : "they stay"} as {pick.untouched.length === 1 ? "it is" : "they are"}.</p> : null}
            <p className="plx-small" style={{ margin: 0 }}>Changes you haven&apos;t made live yet on these pages are replaced.</p>
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}

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
      <SiteDays siteId={siteId} />
      {pages && pageId ? <div className="plx-adv__pick"><PagePicker pages={pages} value={pageId} onChange={setPageId} /></div> : null}
      <Card>
        <CardHeader title="One page at a time" description="Every version of the page you picked. A version is saved each time the page goes live." />
        {list === null ? (
          <div style={{ padding: "32px 16px", display: "grid", placeItems: "center" }}><OptimisticLoader title="Loading version history" subtitle="Retrieving saved publishing revisions" steps={["Loading page revision history…", "Comparing deployment hashes…", "Ready."]} /></div>
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
