"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, History, RefreshCw } from "lucide-react";
import { Badge, Button, ButtonLink, Modal, Skeleton, useToast } from "../ui";
import { errMsg, hubApi } from "../hub/hubApi";
import { OUTCOME_LABEL, SCOPE_LABEL, movedSentence, type HistoryEntry, type RerunPreview, type RerunScope } from "@/lib/wpMigration/history";
import { Panel } from "./bits";

type SiteRow = { templateId: string; siteName: string; sourceUrl: string; runs: HistoryEntry[]; active: boolean; latestJobId: string; steps: RerunScope[]; canRerun: boolean };

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const host = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");

/**
 * Every WordPress move on the account (or one site's own), with each run, what it moved and how it ended, plus
 * "run again": the whole move or one step. Nothing runs until the person has read what it will change and said yes.
 */
export function MigrationHistory({ siteId, emptyHint }: { siteId?: string; emptyHint?: string }) {
  const router = useRouter();
  const { show } = useToast();
  const [rows, setRows] = useState<SiteRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ row: SiteRow; scope: RerunScope; preview: RerunPreview | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    hubApi<{ sites: SiteRow[] }>(`/api/v1/wp-migration/history${siteId ? `?site=${siteId}` : ""}`).then((r) => setRows(r.sites), (e) => setError(errMsg(e, "We couldn't load your WordPress moves.")));
  }, [siteId]);
  useEffect(load, [load]);

  async function choose(row: SiteRow, scope: RerunScope) {
    setError(null);
    setAsk({ row, scope, preview: null });
    try {
      const r = await hubApi<{ preview: RerunPreview }>(`/api/v1/wp-migration/${row.templateId}/${row.latestJobId}/rerun`, { method: "POST", json: { scope } });
      setAsk({ row, scope, preview: r.preview });
    } catch (e) {
      setAsk(null);
      setError(errMsg(e));
    }
  }
  async function confirm() {
    if (!ask) return;
    setBusy(true);
    try {
      const r = await hubApi<{ href: string }>(`/api/v1/wp-migration/${ask.row.templateId}/${ask.row.latestJobId}/rerun`, { method: "POST", json: { scope: ask.scope, confirm: true } });
      show({ title: "Started", description: "We're copying it again. You can watch it here.", tone: "success" });
      setAsk(null);
      router.push(r.href);
    } catch (e) {
      setAsk(null);
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (rows === null && !error) return <Panel><Skeleton height={20} width="40%" /></Panel>;
  return (
    <>
      {error ? <GateOrError error={error}><div className="plx-inlinemsg plx-inlinemsg--bad" role="alert">{error}</div></GateOrError> : null}
      {rows && rows.length === 0 ? (
        <Panel title="No WordPress moves yet" description={emptyHint ?? "When you move a WordPress site to Plexo, every run is kept here: when it ran, what came across, and how it ended."}>
          <div style={{ padding: "0 24px 24px" }}><ButtonLink href="/dashboard/migrate/wordpress" leftIcon={<Download size={18} aria-hidden />}>Move a WordPress site</ButtonLink></div>
        </Panel>
      ) : null}
      {rows?.map((row) => (
        <Panel
          key={row.templateId}
          title={row.siteName}
          description={`Moved from ${host(row.sourceUrl)}`}
          action={<ButtonLink href={`/dashboard/migrate/wordpress?job=${row.latestJobId}&site=${row.templateId}`} variant="secondary" size="sm">See the full report</ButtonLink>}
        >
          <div style={{ padding: "0 24px 8px", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }} aria-label={`Run again for ${row.siteName}`} role="group">
            <Button variant="secondary" size="sm" leftIcon={<RefreshCw size={16} aria-hidden />} disabled={!row.canRerun} onClick={() => void choose(row, "all")}>Run the whole move again</Button>
            {row.steps.map((s) => (
              <Button key={s} variant="secondary" size="sm" disabled={!row.canRerun} onClick={() => void choose(row, s)}>{SCOPE_LABEL[s]} again</Button>
            ))}
            {row.active ? <span className="plx-small">A move is running right now, so it can&apos;t be started again yet.</span> : null}
          </div>
          <ul className="plx-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {row.runs.map((r) => {
              const o = OUTCOME_LABEL[r.outcome];
              return (
                <li key={r.id} className="plx-hrow" style={{ alignItems: "flex-start" }}>
                  <span className="plx-hrow__main">
                    <span className="plx-hrow__title" style={{ whiteSpace: "normal" }}>
                      <History size={15} aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
                      Run {r.number}: {r.scope === "all" ? (r.number === 1 ? "first move" : "whole move") : SCOPE_LABEL[r.scope]}
                    </span>
                    <span className="plx-hrow__sub" style={{ whiteSpace: "normal" }}>{when(r.startedAt)}{r.finishedAt ? `, took ${Math.max(1, Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 60000))} min` : ""}</span>
                    <span className="plx-hrow__sub" style={{ whiteSpace: "normal" }}>{movedSentence(r)}</span>
                    {r.error ? <span className="plx-hrow__sub" style={{ whiteSpace: "normal", color: "var(--plx-danger)" }}>{r.error}</span> : null}
                  </span>
                  <span className="plx-hrow__end"><Badge tone={o.tone}>{o.text}</Badge></span>
                </li>
              );
            })}
          </ul>
        </Panel>
      ))}
      <Modal
        open={!!ask}
        onClose={() => (busy ? undefined : setAsk(null))}
        title={ask?.preview?.title ?? "Checking…"}
        description={ask ? `For ${ask.row.siteName}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsk(null)} disabled={busy}>Not now</Button>
            <Button onClick={() => void confirm()} loading={busy} disabled={!ask?.preview}>Yes, run it again</Button>
          </>
        }
      >
        {ask?.preview ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p className="plx-body" style={{ margin: 0 }}><b>What it does.</b> {ask.preview.willDo}</p>
            <div className="plx-inlinemsg plx-inlinemsg--warn" role="note"><b>What changes.</b> {ask.preview.willReplace}</div>
            <p className="plx-small" style={{ margin: 0 }}><b>What stays.</b> {ask.preview.keeps}</p>
            <p className="plx-small" style={{ margin: 0 }}>It&apos;s safe to run more than once: nothing is copied twice, and your old WordPress site isn&apos;t touched.</p>
          </div>
        ) : (
          <Skeleton height={20} width="70%" />
        )}
      </Modal>
    </>
  );
}
