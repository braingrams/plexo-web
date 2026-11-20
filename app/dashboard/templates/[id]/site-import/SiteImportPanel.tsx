"use client";

import { GateOrError } from "../../../_components/UpgradePrompt";
import { rememberPlanGate } from "@/lib/plan/planGate";
import { useEffect, useRef, useState } from "react";

type Phase = "PENDING" | "DETECTING" | "DISCOVERING" | "FETCHING" | "REWRITING" | "COMPLETED" | "PAUSED_ERROR" | "FAILED" | "CANCELLED";
type Platform = "WORDPRESS" | "SQUARESPACE" | "WIX" | "WEBFLOW" | "UNKNOWN";

type Job = {
  id: string;
  phase: Phase;
  platform: Platform;
  importBlogPosts: boolean;
  totalPages: number | null;
  processedPages: number;
  errors: string[];
  lastHeartbeatAt: string | null;
};

type ReportPage = {
  sourceUrl: string;
  outcome: string;
  plexoPath: string | null;
  heuristicExtraction: boolean;
  usedHeadless: boolean;
  error: string | null;
  interactiveFeatures: { flag: string; label: string }[];
};

type Report = {
  phase: Phase;
  pagesCreated: number;
  postsCreated: number;
  pagesFailed: number;
  assetsInternalized: number;
  warnings: string[];
  errors: string[];
  pages: ReportPage[];
};

const STALE_HEARTBEAT_MS = 2 * 60 * 1000;
const TERMINAL_PHASES: Phase[] = ["COMPLETED", "FAILED", "CANCELLED"];
const NON_TERMINAL_PHASES: Phase[] = ["PENDING", "DETECTING", "DISCOVERING", "FETCHING", "REWRITING", "PAUSED_ERROR"];

const inputStyle: React.CSSProperties = {
  flex: 1, background: "var(--ed-w-050)", border: "1px solid var(--ed-w-120)",
  borderRadius: 7, color: "var(--ed-text)", padding: "0.4rem 0.6rem", fontSize: "0.82rem", outline: "none", fontFamily: "inherit",
};
const smallBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "0.35rem",
  padding: "0.35rem 0.7rem", borderRadius: 7, border: "1px solid var(--ed-w-100)",
  background: "transparent", color: "var(--ed-t-700)", cursor: "pointer", fontFamily: "inherit",
  fontSize: "0.76rem", fontWeight: 600,
};
const smallBtnPrimary: React.CSSProperties = {
  ...smallBtn, border: "none", background: "var(--ed-cta)", color: "var(--ed-on-brand)",
};

const PHASE_TEXT: Record<Phase, string> = {
  PENDING: "Starting…",
  DETECTING: "Looking at your site…",
  DISCOVERING: "Finding pages…",
  FETCHING: "Importing pages…",
  REWRITING: "Fixing up links…",
  COMPLETED: "Done!",
  PAUSED_ERROR: "Paused after an error",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

const PLATFORM_LABEL: Record<Platform, string> = {
  WORDPRESS: "WordPress",
  SQUARESPACE: "Squarespace",
  WIX: "Wix",
  WEBFLOW: "Webflow",
  UNKNOWN: "Generic HTML site",
};

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

/**
 * Embeddable "import a website" flow — lives inline in PagesPanel's "Add page" flow (Pages ->
 * Add new -> Import) rather than as a standalone routed page, so starting/watching/finishing
 * an import never leaves the Pages modal. `onImported` is called on every live update so the
 * page tree behind this panel refreshes as new pages land, not just once at the very end.
 */
export function SiteImportPanel({
  templateId,
  onImported,
  onClose,
}: {
  templateId: string;
  onImported: () => void;
  onClose: () => void;
}) {
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [step, setStep] = useState<"url" | "confirm">("url");
  const [url, setUrl] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detectedPlatform, setDetectedPlatform] = useState<Platform>("UNKNOWN");
  const [platformOverride, setPlatformOverride] = useState<Platform | null>(null);
  const [importBlogPosts, setImportBlogPosts] = useState(true);
  const [ownershipAttested, setOwnershipAttested] = useState(false);
  const [aupPending, setAupPending] = useState(false);

  const [job, setJob] = useState<Job | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [starting, setStarting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepLoopJobIdRef = useRef<string | null>(null);

  // Pick up an already-running (or most recent) job for this site, so reopening the Pages
  // panel resumes watching an import instead of losing track of it.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/site-import/${templateId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { jobs?: Job[] } | null) => {
        if (cancelled || !data?.jobs) return;
        const active = data.jobs.find((j) => NON_TERMINAL_PHASES.includes(j.phase)) ?? data.jobs[0] ?? null;
        if (active) setJob(active);
      })
      .finally(() => {
        if (!cancelled) setLoadingInitial(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  useEffect(() => {
    if (!job || TERMINAL_PHASES.includes(job.phase)) {
      if (pollRef.current) clearInterval(pollRef.current);
      if (job && TERMINAL_PHASES.includes(job.phase) && !report) void loadReport(job.id);
      return;
    }
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/v1/site-import/${templateId}/${job.id}`);
      if (res.ok) {
        const { job: updated } = await res.json();
        setJob({
          id: updated.id,
          phase: updated.phase,
          platform: updated.platform,
          importBlogPosts: updated.importBlogPosts,
          totalPages: updated.totalPages,
          processedPages: updated.processedPages,
          errors: Array.isArray(updated.errors) ? updated.errors : [],
          lastHeartbeatAt: updated.lastHeartbeatAt ?? null,
        });
        onImported(); // pages may have landed since the last tick — keep the tree behind this panel fresh
      }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, templateId]);

  useEffect(() => {
    if (!job || TERMINAL_PHASES.includes(job.phase)) {
      if (tickRef.current) clearInterval(tickRef.current);
      return;
    }
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [job]);

  async function loadReport(jobId: string) {
    const res = await fetch(`/api/v1/site-import/${templateId}/${jobId}/report`);
    if (res.ok) setReport(await res.json());
  }

  async function stepOnce(jobId: string): Promise<{ done: boolean; phase: Phase } | null> {
    try {
      const res = await fetch(`/api/v1/site-import/${templateId}/${jobId}/step`, { method: "POST" });
      if (!res.ok) return null;
      const data = await res.json();
      return { done: Boolean(data.done), phase: data.phase as Phase };
    } catch {
      return null;
    }
  }

  async function runStepLoop(jobId: string) {
    if (stepLoopJobIdRef.current === jobId) return;
    stepLoopJobIdRef.current = jobId;
    setStepError(null);
    try {
      for (;;) {
        if (stepLoopJobIdRef.current !== jobId) return;
        const result = await stepOnce(jobId);
        if (!result) {
          setStepError("Lost connection while importing — click Retry now to continue.");
          return;
        }
        if (result.done || result.phase === "PAUSED_ERROR") return;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    } finally {
      if (stepLoopJobIdRef.current === jobId) stepLoopJobIdRef.current = null;
    }
  }

  useEffect(() => {
    if (!job || TERMINAL_PHASES.includes(job.phase)) return;
    runStepLoop(job.id);
    return () => {
      if (stepLoopJobIdRef.current === job.id) stepLoopJobIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  async function handleDetect() {
    if (!url.trim()) return;
    setDetecting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/site-import/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: url }),
      });
      const data = await res.json();
      if (!res.ok) {
        rememberPlanGate(data);
        setError(data.error ?? "Couldn't reach that site.");
        return;
      }
      if (!data.reachable) {
        setError("Couldn't reach that site — check the URL and try again.");
        return;
      }
      setDetectedPlatform(data.platform);
      setPlatformOverride(null);
      setStep("confirm");
    } finally {
      setDetecting(false);
    }
  }

  async function handleStart(acceptAup = false) {
    if (!ownershipAttested) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/site-import/${templateId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: url,
          importBlogPosts,
          platformOverride: platformOverride ?? undefined,
          ownershipAttested: true,
          ...(acceptAup ? { acceptAup: true } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.requiresAupAcceptance && !acceptAup) {
          setAupPending(true);
          return;
        }
        setError(data.error ?? "Couldn't start the import.");
        return;
      }
      setAupPending(false);
      setJob({
        id: data.job.id,
        phase: data.job.phase,
        platform: data.job.platform,
        importBlogPosts: data.job.importBlogPosts,
        totalPages: data.job.totalPages,
        processedPages: data.job.processedPages,
        errors: [],
        lastHeartbeatAt: data.job.lastHeartbeatAt ?? null,
      });
    } finally {
      setStarting(false);
    }
  }

  async function handleCancel() {
    if (!job) return;
    if (!window.confirm("Stop this import? Pages already imported will stay — only the remaining pages won't be migrated.")) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/v1/site-import/${templateId}/${job.id}`, { method: "DELETE" });
      if (res.ok) setJob({ ...job, phase: "CANCELLED" });
    } finally {
      setCancelling(false);
    }
  }

  async function handleRetry() {
    if (!job) return;
    setRetrying(true);
    try {
      await runStepLoop(job.id);
    } finally {
      setRetrying(false);
    }
  }

  if (loadingInitial) {
    return <p style={{ fontSize: "0.78rem", color: "var(--ed-t-400)" }}>Checking for an import in progress…</p>;
  }

  const progressPct = job?.totalPages ? Math.min(100, Math.round((job.processedPages / job.totalPages) * 100)) : job?.phase === "COMPLETED" ? 100 : 0;
  const heartbeatMs = job?.lastHeartbeatAt ? now - new Date(job.lastHeartbeatAt).getTime() : null;
  const isStale = job && !TERMINAL_PHASES.includes(job.phase) && job.phase !== "PAUSED_ERROR" && heartbeatMs !== null && heartbeatMs > STALE_HEARTBEAT_MS;
  const showRetry = job?.phase === "PAUSED_ERROR" || isStale || !!stepError;
  const showCancel = job && !TERMINAL_PHASES.includes(job.phase);

  let statusLine = job ? PHASE_TEXT[job.phase] : "";
  if (job?.phase === "PAUSED_ERROR" && heartbeatMs !== null) {
    statusLine = `Paused after an error, ${formatElapsed(heartbeatMs)}. Click Retry now to continue, or it resumes automatically within a day.`;
  } else if (stepError) {
    statusLine = stepError;
  } else if (isStale && heartbeatMs !== null) {
    statusLine = `No update for ${formatElapsed(heartbeatMs)} — keep this panel open, or click Retry now.`;
  } else if (job && heartbeatMs !== null && !TERMINAL_PHASES.includes(job.phase)) {
    statusLine = `${PHASE_TEXT[job.phase]} (last update ${formatElapsed(heartbeatMs)})`;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {!job && step === "url" && (
        <>
          <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--ed-t-500)" }}>Website URL</label>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleDetect(); }}
              placeholder="mysite.com"
              style={inputStyle}
            />
            <button type="button" onClick={() => void handleDetect()} disabled={detecting || !url.trim()} style={smallBtnPrimary}>
              {detecting ? "Checking…" : "Continue"}
            </button>
            <button type="button" onClick={onClose} style={smallBtn}>Cancel</button>
          </div>
          {error && <GateOrError error={error}><p style={{ color: "var(--ed-danger)", fontSize: "0.75rem" }}>{error}</p></GateOrError>}
        </>
      )}

      {!job && step === "confirm" && (
        <>
          <div>
            <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--ed-t-500)", display: "block", marginBottom: "0.35rem" }}>Platform</label>
            <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
              {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlatformOverride(p)}
                  style={{
                    padding: "0.3rem 0.6rem", borderRadius: 7, border: "1px solid var(--ed-w-120)", cursor: "pointer",
                    fontSize: "0.72rem", fontWeight: 700,
                    background: (platformOverride ?? detectedPlatform) === p ? "var(--brand-subtle)" : "transparent",
                    color: (platformOverride ?? detectedPlatform) === p ? "var(--ed-accent-text)" : "var(--ed-t-600)",
                  }}
                >
                  {PLATFORM_LABEL[p]}{p === detectedPlatform && !platformOverride ? " (detected)" : ""}
                </button>
              ))}
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem", color: "var(--ed-t-750)", cursor: "pointer" }}>
            <input type="checkbox" checked={importBlogPosts} onChange={(e) => setImportBlogPosts(e.target.checked)} />
            Also import blog posts as editable posts
          </label>

          <div style={{ padding: "0.7rem 0.8rem", borderRadius: 8, background: "var(--ed-w-030)", border: "1px solid var(--ed-w-080)" }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.75rem", color: "var(--ed-t-700)", cursor: "pointer", lineHeight: 1.4 }}>
              <input type="checkbox" checked={ownershipAttested} onChange={(e) => setOwnershipAttested(e.target.checked)} style={{ marginTop: "0.15rem" }} />
              <span>I own <strong>{url}</strong>, or am authorized to migrate it.</span>
            </label>
          </div>

          {error && <GateOrError error={error}><p style={{ color: "var(--ed-danger)", fontSize: "0.75rem" }}>{error}</p></GateOrError>}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" onClick={() => void handleStart()} disabled={starting || !ownershipAttested} style={{ ...smallBtnPrimary, opacity: !ownershipAttested ? 0.5 : 1 }}>
              {starting ? "Starting…" : "Start import"}
            </button>
            <button type="button" onClick={() => setStep("url")} style={smallBtn}>Back</button>
            <button type="button" onClick={onClose} style={smallBtn}>Cancel</button>
          </div>
        </>
      )}

      {aupPending && (
        <div style={{ padding: "0.8rem 0.9rem", borderRadius: 8, background: "color-mix(in srgb, var(--brand) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--brand) 30%, transparent)" }}>
          <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--ed-text)", marginBottom: "0.4rem" }}>Accept the Acceptable Use Policy</p>
          <p style={{ fontSize: "0.75rem", color: "var(--ed-t-600)", marginBottom: "0.75rem", lineHeight: 1.4 }}>
            Imported pages are published exactly as fetched, with no content sanitization. Required once per account.{" "}
            <a href="/legal/acceptable-use" target="_blank" rel="noopener noreferrer" style={{ color: "var(--ed-accent-text)" }}>Read the policy</a>.
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" onClick={() => setAupPending(false)} style={smallBtn}>Cancel</button>
            <button type="button" onClick={() => void handleStart(true)} disabled={starting} style={smallBtnPrimary}>
              {starting ? "Starting…" : "Accept & Import"}
            </button>
          </div>
        </div>
      )}

      {job && (
        <>
          <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--ed-text)" }}>{statusLine}</p>
          <div style={{ height: 7, borderRadius: 999, background: "var(--ed-w-080)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progressPct}%`, background: "var(--brand)", transition: "width 0.4s" }} />
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--ed-t-500)" }}>
            {job.processedPages}{job.totalPages ? ` / ${job.totalPages}` : ""} pages processed
          </p>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {showRetry && (
              <button type="button" onClick={() => void handleRetry()} disabled={retrying} style={{ ...smallBtn, borderColor: "var(--brand)", color: "var(--ed-accent-text)" }}>
                {retrying ? "Retrying…" : "Retry now"}
              </button>
            )}
            {showCancel && (
              <button type="button" onClick={() => void handleCancel()} disabled={cancelling} style={{ ...smallBtn, borderColor: "color-mix(in srgb, var(--ed-danger) 40%, transparent)", color: "var(--ed-danger)" }}>
                {cancelling ? "Cancelling…" : "Cancel import"}
              </button>
            )}
            {TERMINAL_PHASES.includes(job.phase) && (
              <button type="button" onClick={onClose} style={smallBtn}>Close</button>
            )}
          </div>

          {job.errors.length > 0 && (
            <div>
              <p style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--ed-amber)", marginBottom: "0.3rem" }}>
                {job.errors.length} item{job.errors.length === 1 ? "" : "s"} need a look:
              </p>
              <ul style={{ fontSize: "0.7rem", color: "var(--ed-t-600)", paddingLeft: "1rem", maxHeight: 120, overflowY: "auto" }}>
                {job.errors.map((e, i) => <li key={i} style={{ marginBottom: "0.25rem" }}>{e}</li>)}
              </ul>
            </div>
          )}

          {report && TERMINAL_PHASES.includes(job.phase) && (
            <div style={{ paddingTop: "0.75rem", borderTop: "1px solid var(--ed-w-080)" }}>
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                {[
                  { label: "Pages", value: report.pagesCreated },
                  { label: "Posts", value: report.postsCreated },
                  { label: "Assets", value: report.assetsInternalized },
                ].map((tile) => (
                  <div key={tile.label} style={{ flex: "1 1 90px", padding: "0.5rem 0.6rem", borderRadius: 8, background: "var(--ed-w-030)", border: "1px solid var(--ed-w-080)" }}>
                    <p style={{ fontSize: "1.1rem", fontWeight: 800, color: "var(--ed-text)" }}>{tile.value}</p>
                    <p style={{ fontSize: "0.68rem", color: "var(--ed-t-500)" }}>{tile.label}</p>
                  </div>
                ))}
              </div>

              {report.warnings.length > 0 && (
                <div style={{ marginBottom: "0.75rem" }}>
                  <ul style={{ fontSize: "0.72rem", color: "var(--ed-t-550)", paddingLeft: "1rem" }}>
                    {report.warnings.map((w, i) => <li key={i} style={{ marginBottom: "0.25rem" }}>{w}</li>)}
                  </ul>
                </div>
              )}

              {report.pages.some((p) => p.interactiveFeatures.length > 0) && (
                <div style={{ marginBottom: "0.75rem" }}>
                  <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--ed-amber)", marginBottom: "0.35rem" }}>Some interactive features won&apos;t work after migration</p>
                  <ul style={{ fontSize: "0.72rem", color: "var(--ed-t-650)", paddingLeft: "1rem", maxHeight: 140, overflowY: "auto" }}>
                    {report.pages.filter((p) => p.interactiveFeatures.length > 0).map((p) => (
                      <li key={p.sourceUrl} style={{ marginBottom: "0.3rem" }}>
                        <strong>{p.plexoPath ?? p.sourceUrl}</strong>: {p.interactiveFeatures.map((f) => f.label).join("; ")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {report.pages.some((p) => p.heuristicExtraction) && (
                <div>
                  <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--ed-t-700)", marginBottom: "0.35rem" }}>Heuristically extracted — please review</p>
                  <ul style={{ fontSize: "0.72rem", color: "var(--ed-t-550)", paddingLeft: "1rem", maxHeight: 140, overflowY: "auto" }}>
                    {report.pages.filter((p) => p.heuristicExtraction).map((p) => <li key={p.sourceUrl} style={{ marginBottom: "0.25rem" }}>{p.plexoPath ?? p.sourceUrl}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
