"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PageContainer } from "../../../_components/PageContainer";

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

const PANEL: React.CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "1.5rem", background: "rgba(255,255,255,0.02)" };
const FIELD_INPUT: React.CSSProperties = { width: "100%", padding: "0.65rem 0.8rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)", color: "#f0f2ff", fontSize: "0.9rem" };

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

export function SiteImportClient({
  templateId,
  templateName,
  isUltra,
  initialJob,
}: {
  templateId: string;
  templateName: string;
  isUltra: boolean;
  initialJob: Job | null;
}) {
  const [step, setStep] = useState<"url" | "confirm">("url");
  const [url, setUrl] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detectedPlatform, setDetectedPlatform] = useState<Platform>("UNKNOWN");
  const [platformOverride, setPlatformOverride] = useState<Platform | null>(null);
  const [importBlogPosts, setImportBlogPosts] = useState(true);
  const [ownershipAttested, setOwnershipAttested] = useState(false);
  // Set when the account hasn't accepted the AUP yet (same account-level gate as a raw
  // upload, since imported pages are RAW_UPLOAD under the hood) — starting the import again
  // with acceptAup:true resubmits the exact same request rather than losing the form state.
  const [aupPending, setAupPending] = useState(false);

  const [job, setJob] = useState<Job | null>(initialJob);
  const [report, setReport] = useState<Report | null>(null);
  const [starting, setStarting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Same driving mechanism as app/dashboard/templates/[id]/blog/import/ImportClient.tsx: the
  // browser loops the step endpoint (not a server self-continuation, which trips Vercel's own
  // loop protection over HTTP).
  const stepLoopJobIdRef = useRef<string | null>(null);

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

  if (!isUltra) {
    return (
      <PageContainer>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f0f2ff", marginBottom: "0.5rem" }}>Import a website</h1>
        <div style={PANEL}>
          <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.7)" }}>
            Importing a whole website (WordPress, Squarespace, Wix, or Webflow) requires the <strong>Ultra</strong> plan.
          </p>
        </div>
      </PageContainer>
    );
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
    statusLine = `No update for ${formatElapsed(heartbeatMs)} — keep this tab open, or click Retry now.`;
  } else if (job && heartbeatMs !== null && !TERMINAL_PHASES.includes(job.phase)) {
    statusLine = `${PHASE_TEXT[job.phase]} (last update ${formatElapsed(heartbeatMs)})`;
  }

  return (
    <PageContainer>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f0f2ff", marginBottom: "0.25rem" }}>Import a website</h1>
      <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", marginBottom: "1.5rem" }}>
        Cloning into <strong>{templateName}</strong> — from WordPress, Squarespace, Wix, or Webflow. We&apos;ll fetch every page we can
        find, bring same-site CSS/JS/images along, and rewrite links between pages so they stay connected once imported.
      </p>

      {!job && step === "url" && (
        <div style={PANEL}>
          <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "rgba(240,242,255,0.5)", display: "block", marginBottom: "0.5rem" }}>
            Website URL
          </label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleDetect(); }}
            placeholder="mysite.com"
            style={{ ...FIELD_INPUT, marginBottom: "0.75rem" }}
          />
          {error && <p style={{ color: "#f87171", fontSize: "0.8rem", marginBottom: "0.75rem" }}>{error}</p>}
          <button
            type="button"
            onClick={handleDetect}
            disabled={detecting || !url.trim()}
            style={{ padding: "0.6rem 1.3rem", borderRadius: 8, border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 700, background: "var(--brand)", color: "#fff" }}
          >
            {detecting ? "Checking…" : "Continue"}
          </button>
        </div>
      )}

      {!job && step === "confirm" && (
        <div style={PANEL}>
          <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "rgba(240,242,255,0.5)", display: "block", marginBottom: "0.5rem" }}>
            Platform
          </label>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.9rem", flexWrap: "wrap" }}>
            {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatformOverride(p)}
                style={{
                  padding: "0.4rem 0.9rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer",
                  fontSize: "0.78rem", fontWeight: 700,
                  background: (platformOverride ?? detectedPlatform) === p ? "var(--brand-subtle)" : "transparent",
                  color: (platformOverride ?? detectedPlatform) === p ? "var(--brand)" : "rgba(240,242,255,0.6)",
                }}
              >
                {PLATFORM_LABEL[p]}{p === detectedPlatform && !platformOverride ? " (detected)" : ""}
              </button>
            ))}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.82rem", color: "rgba(240,242,255,0.75)", marginBottom: "1rem", cursor: "pointer" }}>
            <input type="checkbox" checked={importBlogPosts} onChange={(e) => setImportBlogPosts(e.target.checked)} />
            Also import blog posts as editable posts (not just pages)
          </label>

          <div style={{ padding: "0.9rem 1rem", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", marginBottom: "1rem" }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", fontSize: "0.8rem", color: "rgba(240,242,255,0.7)", cursor: "pointer", lineHeight: 1.5 }}>
              <input type="checkbox" checked={ownershipAttested} onChange={(e) => setOwnershipAttested(e.target.checked)} style={{ marginTop: "0.15rem" }} />
              <span>
                I own <strong>{url}</strong>, or am authorized to migrate it. Plexo isn&apos;t a tool for copying someone else&apos;s
                site without permission.
              </span>
            </label>
          </div>

          {error && <p style={{ color: "#f87171", fontSize: "0.8rem", marginBottom: "0.75rem" }}>{error}</p>}
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={starting || !ownershipAttested}
              style={{ padding: "0.6rem 1.3rem", borderRadius: 8, border: "none", cursor: starting || !ownershipAttested ? "default" : "pointer", fontSize: "0.85rem", fontWeight: 700, background: "var(--brand)", color: "#fff", opacity: !ownershipAttested ? 0.5 : 1 }}
            >
              {starting ? "Starting…" : "Start import"}
            </button>
            <button type="button" onClick={() => setStep("url")} style={{ padding: "0.6rem 1.1rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", fontSize: "0.85rem", fontWeight: 700, background: "transparent", color: "rgba(240,242,255,0.6)" }}>
              Back
            </button>
          </div>
        </div>
      )}

      {aupPending && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 70, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.6)", padding: "1rem" }}
          onClick={(e) => { if (e.target === e.currentTarget) setAupPending(false); }}
        >
          <div style={{ width: "min(100%,440px)", background: "#0d0f1a", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 16, padding: "1.5rem" }}>
            <h3 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.05rem", fontWeight: 800, color: "#f0f2ff", marginBottom: "0.6rem" }}>
              Accept the Acceptable Use Policy
            </h3>
            <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.6)", marginBottom: "1.25rem", lineHeight: 1.5 }}>
              Imported pages are published exactly as fetched, with no content sanitization — you&apos;re responsible for what the
              imported site contains, including any script it runs. Required once per account, before your first raw import.{" "}
              <a href="/legal/acceptable-use" target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)" }}>
                Read the policy
              </a>.
            </p>
            <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setAupPending(false)} style={{ padding: "0.35rem 0.7rem", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(240,242,255,0.7)", cursor: "pointer", fontSize: "0.76rem", fontWeight: 600 }}>
                Cancel
              </button>
              <button type="button" onClick={() => void handleStart(true)} disabled={starting} style={{ padding: "0.35rem 0.7rem", borderRadius: 7, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", cursor: "pointer", fontSize: "0.76rem", fontWeight: 600 }}>
                {starting ? "Starting…" : "Accept & Import"}
              </button>
            </div>
          </div>
        </div>
      )}

      {job && (
        <div style={PANEL}>
          <p style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.75rem" }}>{statusLine}</p>
          <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden", marginBottom: "0.6rem" }}>
            <div style={{ height: "100%", width: `${progressPct}%`, background: "var(--brand)", transition: "width 0.4s" }} />
          </div>
          <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.5)", marginBottom: "1rem" }}>
            {job.processedPages}
            {job.totalPages ? ` / ${job.totalPages}` : ""} pages processed
          </p>

          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            {job.phase === "COMPLETED" && (
              <Link
                href={`/dashboard/templates/${templateId}`}
                style={{ display: "inline-flex", padding: "0.55rem 1.1rem", borderRadius: 8, background: "var(--brand)", color: "#fff", fontSize: "0.82rem", fontWeight: 700, textDecoration: "none" }}
              >
                View your site
              </Link>
            )}
            {showRetry && (
              <button type="button" onClick={handleRetry} disabled={retrying} style={{ padding: "0.55rem 1.1rem", borderRadius: 8, border: "1px solid var(--brand)", cursor: "pointer", fontSize: "0.82rem", fontWeight: 700, background: "transparent", color: "var(--brand)" }}>
                {retrying ? "Retrying…" : "Retry now"}
              </button>
            )}
            {showCancel && (
              <button type="button" onClick={handleCancel} disabled={cancelling} style={{ padding: "0.55rem 1.1rem", borderRadius: 8, border: "1px solid rgba(248,113,113,0.4)", cursor: "pointer", fontSize: "0.82rem", fontWeight: 700, background: "transparent", color: "#f87171" }}>
                {cancelling ? "Cancelling…" : "Cancel import"}
              </button>
            )}
          </div>

          {job.errors.length > 0 && (
            <div style={{ marginTop: "1.25rem" }}>
              <p style={{ fontSize: "0.78rem", fontWeight: 700, color: "#f59e0b", marginBottom: "0.5rem" }}>
                {job.errors.length} item{job.errors.length === 1 ? "" : "s"} need a look:
              </p>
              <ul style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.6)", paddingLeft: "1.1rem", maxHeight: 200, overflowY: "auto" }}>
                {job.errors.map((e, i) => <li key={i} style={{ marginBottom: "0.3rem" }}>{e}</li>)}
              </ul>
            </div>
          )}

          {report && TERMINAL_PHASES.includes(job.phase) && (
            <div style={{ marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
                {[
                  { label: "Pages imported", value: report.pagesCreated },
                  { label: "Posts imported", value: report.postsCreated },
                  { label: "Assets brought over", value: report.assetsInternalized },
                ].map((tile) => (
                  <div key={tile.label} style={{ flex: "1 1 140px", padding: "0.75rem 0.9rem", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <p style={{ fontSize: "1.3rem", fontWeight: 800, color: "#f0f2ff" }}>{tile.value}</p>
                    <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.5)" }}>{tile.label}</p>
                  </div>
                ))}
              </div>

              {report.pages.some((p) => p.interactiveFeatures.length > 0) && (
                <div style={{ marginBottom: "1.25rem" }}>
                  <p style={{ fontSize: "0.82rem", fontWeight: 700, color: "#f59e0b", marginBottom: "0.5rem" }}>
                    Some interactive features won&apos;t work after migration
                  </p>
                  <ul style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.65)", paddingLeft: "1.1rem" }}>
                    {report.pages.filter((p) => p.interactiveFeatures.length > 0).map((p) => (
                      <li key={p.sourceUrl} style={{ marginBottom: "0.4rem" }}>
                        <strong>{p.plexoPath ?? p.sourceUrl}</strong>: {p.interactiveFeatures.map((f) => f.label).join("; ")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {report.pages.some((p) => p.heuristicExtraction) && (
                <div style={{ marginBottom: "1.25rem" }}>
                  <p style={{ fontSize: "0.82rem", fontWeight: 700, color: "rgba(240,242,255,0.7)", marginBottom: "0.5rem" }}>
                    Heuristically extracted — please review
                  </p>
                  <ul style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.55)", paddingLeft: "1.1rem" }}>
                    {report.pages.filter((p) => p.heuristicExtraction).map((p) => (
                      <li key={p.sourceUrl} style={{ marginBottom: "0.3rem" }}>{p.plexoPath ?? p.sourceUrl}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
