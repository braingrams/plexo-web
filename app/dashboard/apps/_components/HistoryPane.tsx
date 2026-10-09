"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { appsApi, ApiError, type BuildReport } from "./api";
import { C, Button, Panel, Notice, Empty, timeAgo } from "./ui";

// Every version of the app (each AI turn, Code Mode build, deploy, restore, GitHub push) with
// one-click restore, plus the build log of every build.

type Version = Awaited<ReturnType<typeof appsApi.versions>>["versions"][number];
type BuildRow = Awaited<ReturnType<typeof appsApi.builds>>["builds"][number];

const SOURCE: Record<string, string> = { ai: "SOL", editor: "Code", deploy: "Deploy", restore: "Restore", scaffold: "Created", git: "GitHub" };

export function HistoryPane(props: { appId: string; refreshKey?: number; onRestored?: (buildId: string | null) => void; onViewChanges?: (versionId: string, against: string) => void }) {
  const { appId } = props;
  const [view, setView] = useState<"versions" | "builds">("versions");
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [builds, setBuilds] = useState<BuildRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<BuildReport | null>(null);
  const reportRequest = useRef(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [v, b] = await Promise.all([appsApi.versions(appId), appsApi.builds(appId)]);
      setVersions(v.versions);
      setBuilds(b.builds);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the history.");
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load, props.refreshKey]);

  async function restore(v: Version) {
    if (!window.confirm(`Restore "${v.message}"?\n\nYour files go back to this version (saved as a new version, so you can undo it). The live app only changes when you publish.`)) return;
    setBusy(v.id);
    setNotice(null);
    try {
      const res = await appsApi.restore(appId, v.id);
      setNotice("Restored — rebuilding the preview.");
      props.onRestored?.(res.buildId);
      await load();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Couldn't restore that version.");
    } finally {
      setBusy(null);
    }
  }

  async function openBuild(id: string) {
    const req = ++reportRequest.current;
    setReport(null);
    try {
      const r = await appsApi.buildReport(appId, id, true);
      if (req === reportRequest.current) setReport(r);
    } catch (err) {
      if (req === reportRequest.current) setNotice(err instanceof ApiError ? err.message : "Couldn't load that build.");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {(["versions", "builds"] as const).map((v) => (
          <Button key={v} size="sm" variant={view === v ? "primary" : "secondary"} onClick={() => setView(v)}>
            {v === "versions" ? "Versions" : "Builds"}
          </Button>
        ))}
      </div>
      {notice && <Notice>{notice}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}

      {view === "versions" && (
        <Panel title="Versions" description="Every change is saved as a version. Restoring one is always undoable.">
          {!versions ? (
            <Empty title="Loading…" />
          ) : versions.length === 0 ? (
            <Empty title="No versions yet" />
          ) : (
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {versions.map((v, i) => {
                const previous = versions[i + 1];
                return (
                  <li key={v.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "0.55rem 0.7rem", borderRadius: 10, border: `1px solid ${C.border}`, background: v.isLive ? "rgba(52,211,153,0.06)" : "transparent", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "0.12rem 0.45rem", borderRadius: 999, background: "rgba(255,255,255,0.06)", color: C.muted }}>{SOURCE[v.source] ?? v.source}</span>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontSize: "0.8rem" }}>
                        {v.message}
                        {v.isLive && <span style={{ marginLeft: 8, color: C.success, fontSize: "0.7rem", fontWeight: 700 }}>● LIVE</span>}
                      </div>
                      <div style={{ fontSize: "0.7rem", color: C.faint }}>
                        {v.authorName ? `${v.authorName} · ` : ""}
                        {timeAgo(v.createdAt)} · {v.fileCount} files{v.commitSha ? ` · ${v.commitSha.slice(0, 7)}` : ""}
                      </div>
                    </div>
                    {previous && props.onViewChanges && (
                      <Button size="sm" variant="ghost" onClick={() => props.onViewChanges!(previous.id, v.id)}>
                        View changes
                      </Button>
                    )}
                    {i > 0 && (
                      <Button size="sm" disabled={busy === v.id} onClick={() => void restore(v)}>
                        {busy === v.id ? "Restoring…" : "Restore"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      )}

      {view === "builds" && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <Panel title="Builds" style={{ flex: "1 1 320px" }}>
            {!builds ? (
              <Empty title="Loading…" />
            ) : builds.length === 0 ? (
              <Empty title="No builds yet" />
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                {builds.map((b) => (
                  <li key={b.id}>
                    <button type="button" onClick={() => void openBuild(b.id)} style={{ width: "100%", textAlign: "left", display: "flex", gap: 8, alignItems: "center", padding: "0.45rem 0.6rem", borderRadius: 8, border: `1px solid ${report?.buildId === b.id ? C.brand : C.border}`, background: "transparent", color: C.text, cursor: "pointer", fontSize: "0.76rem" }}>
                      <span style={{ color: b.status === "SUCCEEDED" ? C.success : b.status === "FAILED" ? C.danger : C.muted }}>●</span>
                      <span style={{ flex: 1 }}>
                        {b.mode === "release" ? "Publish" : "Preview"} · {b.summary ?? b.status.toLowerCase()}
                      </span>
                      <span style={{ color: C.faint }}>{timeAgo(b.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {report && (
            <Panel title={`${report.mode === "release" ? "Publish" : "Preview"} build`} description={report.summary} style={{ flex: "2 1 420px", minWidth: 0 }}>
              {[...report.errors, ...report.typeProblems].length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                  {[...report.errors, ...report.typeProblems].map((e, i) => (
                    <div key={i} style={{ fontSize: "0.76rem", padding: "0.4rem 0.55rem", borderRadius: 8, background: "rgba(0,0,0,0.25)" }}>
                      <div style={{ fontFamily: C.mono, color: e.kind === "type" ? C.warning : C.danger }}>
                        {e.file ?? e.kind}
                        {e.line ? `:${e.line}` : ""}
                      </div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{e.message}</div>
                      {e.snippet && <pre style={{ margin: "4px 0 0", fontFamily: C.mono, color: C.faint, whiteSpace: "pre-wrap" }}>{e.snippet}</pre>}
                    </div>
                  ))}
                </div>
              )}
              {report.migrations && (report.migrations.applied.length > 0 || report.migrations.failed) && (
                <p style={{ fontSize: "0.76rem", color: report.migrations.failed ? C.danger : C.muted }}>
                  {report.migrations.failed
                    ? `Database change ${report.migrations.failed.name} failed: ${report.migrations.failed.message}`
                    : `Database changes applied: ${report.migrations.applied.join(", ")}`}
                </p>
              )}
              {report.functions && (
                <p style={{ fontSize: "0.76rem", color: report.functions.failed.length ? C.danger : C.muted }}>
                  {report.functions.deployed.length > 0 && `Functions deployed: ${report.functions.deployed.join(", ")}. `}
                  {report.functions.failed.map((f) => `${f.name} failed: ${f.message}`).join(" ")}
                </p>
              )}
              {report.log && (
                <pre style={{ margin: 0, maxHeight: 320, overflow: "auto", padding: "0.6rem", borderRadius: 8, background: "rgba(0,0,0,0.35)", fontFamily: C.mono, fontSize: "0.7rem", color: C.muted, whiteSpace: "pre-wrap" }}>{report.log}</pre>
              )}
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
