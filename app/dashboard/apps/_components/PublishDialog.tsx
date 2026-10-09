"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Copy, ExternalLink, Check } from "lucide-react";
import { appsApi, pollBuild, ApiError, type AppSummary, type BuildReport } from "./api";
import { C, Button, Notice, inputStyle } from "./ui";

// Preview → live. A clean release build, then the live database gets new changes, server
// functions deploy, and visitors switch over — with a failed database change leaving the
// live app untouched.

type Step = "build" | "database" | "functions" | "live";
const STEPS: Array<{ id: Step; label: string }> = [
  { id: "build", label: "Building a clean copy" },
  { id: "database", label: "Updating the live database" },
  { id: "functions", label: "Deploying server functions" },
  { id: "live", label: "Going live" },
];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "my-app";
}

export function PublishDialog(props: { appId: string; summary: AppSummary | null; onClose: () => void; onPublished: (report: BuildReport) => void }) {
  const { appId, summary } = props;
  const [subdomain, setSubdomain] = useState(() => slugify(summary?.name ?? ""));
  const [changes, setChanges] = useState<{ added: number; changed: number; removed: number } | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [report, setReport] = useState<BuildReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  const pagesDomain = useMemo(() => {
    try {
      const host = new URL(summary?.previewUrl ?? "").hostname;
      return host.split(".").slice(1).join(".");
    } catch {
      return "";
    }
  }, [summary?.previewUrl]);

  useEffect(() => {
    if (!summary?.liveBuild) return;
    appsApi
      .diff(appId, summary.liveBuild.versionId, "working")
      .then(({ diff }) => setChanges({ added: diff.added.length, changed: diff.changed.length, removed: diff.removed.length }))
      .catch(() => undefined);
  }, [appId, summary?.liveBuild]);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && phase !== "running" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      abort.current?.abort();
    };
  }, [phase, props]);

  const step: Step = !report || report.status !== "SUCCEEDED" ? "build" : report.pending ? "database" : "live";

  async function publish() {
    setPhase("running");
    setError(null);
    abort.current = new AbortController();
    try {
      const { buildId } = await appsApi.publish(appId, summary?.published ? undefined : subdomain.trim() || undefined);
      const final = await pollBuild(appId, buildId, setReport, abort.current.signal);
      setReport(final);
      setPhase(final.ok ? "done" : "failed");
      if (final.ok) props.onPublished(final);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setError(err instanceof ApiError ? err.message : "Publishing couldn't start.");
      setPhase("failed");
    }
  }

  const liveUrl = report?.liveUrl ?? summary?.liveUrl ?? null;

  return (
    <div role="presentation" onClick={(e) => e.target === e.currentTarget && phase !== "running" && props.onClose()} style={{ position: "fixed", inset: 0, zIndex: 65, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", padding: 16 }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="publish-title" style={{ width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "auto", background: C.panelSolid, border: `1px solid ${C.borderStrong}`, borderRadius: 16, padding: "1.2rem 1.3rem", color: C.text, outline: "none" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <h2 id="publish-title" style={{ margin: 0, fontSize: "1.05rem", flex: 1 }}>
            {phase === "done" ? "Your app is live 🎉" : summary?.published ? "Publish changes" : "Publish your app"}
          </h2>
          {phase !== "running" && (
            <button type="button" aria-label="Close" onClick={props.onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
              <X size={18} />
            </button>
          )}
        </div>

        {phase === "idle" && (
          <>
            {summary?.published ? (
              <>
                <p style={{ fontSize: "0.82rem", color: C.muted, marginTop: 0 }}>
                  Visitors to {summary.domains.map((d) => d.domain).join(", ") || "your app"} will get your latest version.
                </p>
                {changes && (
                  <Notice>
                    Since the last publish: {changes.changed} file{changes.changed === 1 ? "" : "s"} changed, {changes.added} added, {changes.removed} removed.
                  </Notice>
                )}
              </>
            ) : (
              <>
                <p style={{ fontSize: "0.82rem", color: C.muted, marginTop: 0 }}>
                  Your app gets its own live address and its own database (separate from the preview, so testing never touches real users' data). You can add your own domain later.
                </p>
                <label style={{ display: "block", fontSize: "0.74rem", fontWeight: 600, color: C.muted, marginBottom: 4 }} htmlFor="publish-subdomain">
                  Address
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input id="publish-subdomain" value={subdomain} onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} style={{ ...inputStyle, flex: 1 }} />
                  <span style={{ fontSize: "0.8rem", color: C.muted, whiteSpace: "nowrap" }}>.{pagesDomain}</span>
                </div>
              </>
            )}
            <p style={{ fontSize: "0.74rem", color: C.faint }}>Any new database changes are applied to the live database. If one fails, nothing changes for your visitors.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <Button onClick={props.onClose}>Cancel</Button>
              <Button variant="primary" onClick={() => void publish()} disabled={!summary?.published && !subdomain.trim()}>
                Publish
              </Button>
            </div>
          </>
        )}

        {(phase === "running" || phase === "failed") && (
          <ol style={{ listStyle: "none", padding: 0, margin: "0.5rem 0", display: "flex", flexDirection: "column", gap: 8 }}>
            {STEPS.map((s) => {
              const index = STEPS.findIndex((x) => x.id === s.id);
              const current = STEPS.findIndex((x) => x.id === step);
              const done = phase !== "failed" && index < current;
              const active = index === current;
              return (
                <li key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "0.82rem", color: done ? C.success : active ? C.text : C.faint }}>
                  <span style={{ width: 18, display: "inline-flex", justifyContent: "center" }}>{done ? <Check size={15} /> : active && phase === "running" ? "…" : "○"}</span>
                  {s.label}
                </li>
              );
            })}
          </ol>
        )}

        {phase === "failed" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            <Notice tone="danger">
              {error ??
                (report?.migrations?.failed
                  ? `The database change ${report.migrations.failed.name} failed: ${report.migrations.failed.message}. Nothing changed for your visitors.`
                  : report?.errors.length
                    ? "The app has errors, so it wasn't published. Nothing changed for your visitors."
                    : report?.summary ?? "Publishing didn't finish.")}
            </Notice>
            {report?.errors.slice(0, 6).map((e, i) => (
              <div key={i} style={{ fontSize: "0.74rem", fontFamily: C.mono, color: C.muted }}>
                {e.file}
                {e.line ? `:${e.line}` : ""} — {e.message}
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button onClick={props.onClose}>Close</Button>
              <Button variant="primary" onClick={() => void publish()}>Try again</Button>
            </div>
          </div>
        )}

        {phase === "done" && liveUrl && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.6rem 0.75rem", borderRadius: 10, background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)" }}>
              <a href={liveUrl} target="_blank" rel="noopener" style={{ flex: 1, color: C.success, fontSize: "0.85rem", wordBreak: "break-all" }}>
                {liveUrl}
              </a>
              <Button size="sm" variant="ghost" aria-label="Copy link" onClick={() => void navigator.clipboard.writeText(liveUrl).then(() => setCopied(true))}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </Button>
              <a href={liveUrl} target="_blank" rel="noopener" aria-label="Open live app" style={{ color: C.muted, display: "inline-flex" }}>
                <ExternalLink size={15} />
              </a>
            </div>
            {report?.functions?.failed.length ? <Notice tone="warning">Some server functions didn't deploy: {report.functions.failed.map((f) => f.name).join(", ")}. The rest of the app is live.</Notice> : null}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button variant="primary" onClick={props.onClose}>Done</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
