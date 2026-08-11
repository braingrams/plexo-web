"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PageContainer } from "../../../../_components/PageContainer";

type JobStatus = "PENDING" | "DISCOVERING" | "RUNNING" | "PAUSED_ERROR" | "COMPLETED" | "FAILED" | "CANCELLED";
type MediaHandling = "RETAIN" | "REHOST";

type Job = {
  id: string;
  status: JobStatus;
  totalPosts: number | null;
  processedPosts: number;
  errors: string[];
  lastHeartbeatAt: string | null;
};

const MAX_REHOST_POSTS = 10;
const STALE_HEARTBEAT_MS = 2 * 60 * 1000;
const TERMINAL_STATUSES: JobStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

const PANEL: React.CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "1.5rem", background: "rgba(255,255,255,0.02)" };
const FIELD_INPUT: React.CSSProperties = { width: "100%", padding: "0.65rem 0.8rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)", color: "#f0f2ff", fontSize: "0.9rem" };

const STATUS_TEXT: Record<JobStatus, string> = {
  PENDING: "Starting…",
  DISCOVERING: "Looking at your site…",
  RUNNING: "Importing…",
  PAUSED_ERROR: "Paused after an error",
  COMPLETED: "Done!",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export function ImportClient({
  templateId,
  templateName,
  initialJob,
}: {
  templateId: string;
  templateName: string;
  initialJob: Job | null;
}) {
  const [mode, setMode] = useState<"url" | "file">("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mediaHandling, setMediaHandling] = useState<MediaHandling>("RETAIN");
  const [job, setJob] = useState<Job | null>(initialJob);
  const [starting, setStarting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!job || TERMINAL_STATUSES.includes(job.status)) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/blog/${templateId}/import/${job.id}`);
      if (res.ok) {
        const { job: updated } = await res.json();
        setJob({
          id: updated.id,
          status: updated.status,
          totalPosts: updated.totalPosts,
          processedPosts: updated.processedPosts,
          errors: Array.isArray(updated.errors) ? updated.errors : [],
          lastHeartbeatAt: updated.lastHeartbeatAt ?? null,
        });
      }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [job, templateId]);

  // Independent of the poll cadence — just keeps "Xs/Xm ago" fresh on screen.
  useEffect(() => {
    if (!job || TERMINAL_STATUSES.includes(job.status)) {
      if (tickRef.current) clearInterval(tickRef.current);
      return;
    }
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [job]);

  async function handleStart() {
    if (mode === "url" && !url.trim()) return;
    if (mode === "file" && !file) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/blog/${templateId}/import`,
        mode === "url"
          ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceUrl: url, mediaHandling }) }
          : {
              method: "POST",
              body: (() => {
                const f = new FormData();
                f.append("file", file as File);
                f.append("mediaHandling", mediaHandling);
                return f;
              })(),
            },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't start the import.");
        return;
      }
      setJob({
        id: data.job.id,
        status: data.job.status,
        totalPosts: data.job.totalPosts,
        processedPosts: data.job.processedPosts,
        errors: [],
        lastHeartbeatAt: data.job.lastHeartbeatAt ?? null,
      });
    } finally {
      setStarting(false);
    }
  }

  async function handleCancel() {
    if (!job) return;
    if (!window.confirm("Stop this import? Posts already imported will stay — only the remaining posts won't be migrated.")) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/blog/${templateId}/import/${job.id}`, { method: "DELETE" });
      if (res.ok) setJob({ ...job, status: "CANCELLED" });
    } finally {
      setCancelling(false);
    }
  }

  async function handleRetry() {
    if (!job) return;
    setRetrying(true);
    try {
      const res = await fetch(`/api/blog/${templateId}/import/${job.id}/retry`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setJob({ ...job, status: data.status ?? "RUNNING", lastHeartbeatAt: new Date().toISOString() });
      }
    } finally {
      setRetrying(false);
    }
  }

  const progressPct = job?.totalPosts ? Math.min(100, Math.round((job.processedPosts / job.totalPosts) * 100)) : job?.status === "COMPLETED" ? 100 : 0;

  const heartbeatMs = job?.lastHeartbeatAt ? now - new Date(job.lastHeartbeatAt).getTime() : null;
  const isStale = job?.status === "RUNNING" && heartbeatMs !== null && heartbeatMs > STALE_HEARTBEAT_MS;
  const showRetry = job?.status === "PAUSED_ERROR" || isStale;
  const showCancel = job && !TERMINAL_STATUSES.includes(job.status);

  let statusLine = job ? STATUS_TEXT[job.status] : "";
  if (job?.status === "PAUSED_ERROR" && heartbeatMs !== null) {
    statusLine = `Paused after an error, ${formatElapsed(heartbeatMs)}. Retries automatically, or retry now below.`;
  } else if (isStale && heartbeatMs !== null) {
    statusLine = `No update for ${formatElapsed(heartbeatMs)} — this may be stuck. Retry now below, or it will resume automatically.`;
  } else if (job && heartbeatMs !== null && !TERMINAL_STATUSES.includes(job.status)) {
    statusLine = `${STATUS_TEXT[job.status]} (last update ${formatElapsed(heartbeatMs)})`;
  }

  return (
    <PageContainer>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f0f2ff", marginBottom: "0.25rem" }}>Import from WordPress</h1>
      <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", marginBottom: "1.5rem" }}>
        Migrating into <strong>{templateName}</strong>. Paste your WordPress site&apos;s URL — no export file, no login needed. If your
        site&apos;s REST API is disabled, upload a WordPress export (.xml) file instead.
      </p>

      {!job && (
        <div style={PANEL}>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            {(["url", "file"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                style={{
                  padding: "0.4rem 0.9rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer",
                  fontSize: "0.78rem", fontWeight: 700,
                  background: mode === m ? "var(--brand-subtle)" : "transparent",
                  color: mode === m ? "var(--brand)" : "rgba(240,242,255,0.6)",
                }}
              >
                {m === "url" ? "Site URL" : "Upload export file"}
              </button>
            ))}
          </div>

          {mode === "url" ? (
            <>
              <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "rgba(240,242,255,0.5)", display: "block", marginBottom: "0.5rem" }}>
                WordPress site URL
              </label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="myblog.com"
                style={{ ...FIELD_INPUT, marginBottom: "0.75rem" }}
              />
            </>
          ) : (
            <>
              <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "rgba(240,242,255,0.5)", display: "block", marginBottom: "0.5rem" }}>
                WordPress export file (Tools &rarr; Export &rarr; All content, in your WP dashboard)
              </label>
              <input
                type="file"
                accept=".xml"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                style={{ ...FIELD_INPUT, marginBottom: "0.75rem" }}
              />
            </>
          )}

          <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "rgba(240,242,255,0.5)", display: "block", marginBottom: "0.5rem" }}>
            Media
          </label>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.4rem" }}>
            {([
              { value: "RETAIN" as const, label: "Retain original media URLs" },
              { value: "REHOST" as const, label: "Rehost to your storage" },
            ]).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMediaHandling(opt.value)}
                style={{
                  padding: "0.4rem 0.9rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer",
                  fontSize: "0.78rem", fontWeight: 700,
                  background: mediaHandling === opt.value ? "var(--brand-subtle)" : "transparent",
                  color: mediaHandling === opt.value ? "var(--brand)" : "rgba(240,242,255,0.6)",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.35)", marginBottom: "0.9rem" }}>
            {mediaHandling === "RETAIN"
              ? "Images keep linking to your old site. Fastest option, works for any size site."
              : `Images are downloaded and re-uploaded to your own storage. Only available for imports of ${MAX_REHOST_POSTS} posts or fewer.`}
          </p>

          {error && <p style={{ color: "#f87171", fontSize: "0.8rem", marginBottom: "0.75rem" }}>{error}</p>}
          <button
            type="button"
            onClick={handleStart}
            disabled={starting}
            style={{ padding: "0.6rem 1.3rem", borderRadius: 8, border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 700, background: "var(--brand)", color: "#fff" }}
          >
            {starting ? "Starting…" : "Start Import"}
          </button>
          <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.35)", marginTop: "0.9rem" }}>
            We&apos;ll pull your published posts, categories, tags, authors, and images — and set up redirects so your old links keep working.
          </p>
        </div>
      )}

      {job && (
        <div style={PANEL}>
          <p style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.75rem" }}>{statusLine}</p>
          <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden", marginBottom: "0.6rem" }}>
            <div style={{ height: "100%", width: `${progressPct}%`, background: "var(--brand)", transition: "width 0.4s" }} />
          </div>
          <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.5)", marginBottom: "1rem" }}>
            {job.processedPosts}
            {job.totalPosts ? ` / ${job.totalPosts}` : ""} posts imported
          </p>

          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            {job.status === "COMPLETED" && (
              <Link
                href={`/dashboard/templates/${templateId}/blog`}
                style={{ display: "inline-flex", padding: "0.55rem 1.1rem", borderRadius: 8, background: "var(--brand)", color: "#fff", fontSize: "0.82rem", fontWeight: 700, textDecoration: "none" }}
              >
                View your blog
              </Link>
            )}

            {showRetry && (
              <button
                type="button"
                onClick={handleRetry}
                disabled={retrying}
                style={{ padding: "0.55rem 1.1rem", borderRadius: 8, border: "1px solid var(--brand)", cursor: "pointer", fontSize: "0.82rem", fontWeight: 700, background: "transparent", color: "var(--brand)" }}
              >
                {retrying ? "Retrying…" : "Retry now"}
              </button>
            )}

            {showCancel && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                style={{ padding: "0.55rem 1.1rem", borderRadius: 8, border: "1px solid rgba(248,113,113,0.4)", cursor: "pointer", fontSize: "0.82rem", fontWeight: 700, background: "transparent", color: "#f87171" }}
              >
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
                {job.errors.map((e, i) => (
                  <li key={i} style={{ marginBottom: "0.3rem" }}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
