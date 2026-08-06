"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type JobStatus = "PENDING" | "DISCOVERING" | "RUNNING" | "PAUSED_ERROR" | "COMPLETED" | "FAILED" | "CANCELLED";

type Job = {
  id: string;
  status: JobStatus;
  totalPosts: number | null;
  processedPosts: number;
  errors: string[];
};

const PANEL: React.CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "1.5rem", background: "rgba(255,255,255,0.02)" };
const FIELD_INPUT: React.CSSProperties = { width: "100%", padding: "0.65rem 0.8rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)", color: "#f0f2ff", fontSize: "0.9rem" };

const STATUS_TEXT: Record<JobStatus, string> = {
  PENDING: "Starting…",
  DISCOVERING: "Looking at your site…",
  RUNNING: "Importing…",
  PAUSED_ERROR: "Paused after an error — will retry automatically",
  COMPLETED: "Done!",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

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
  const [job, setJob] = useState<Job | null>(initialJob);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!job || job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/blog/${templateId}/import/${job.id}`);
      if (res.ok) {
        const { job: updated } = await res.json();
        setJob({ id: updated.id, status: updated.status, totalPosts: updated.totalPosts, processedPosts: updated.processedPosts, errors: Array.isArray(updated.errors) ? updated.errors : [] });
      }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [job, templateId]);

  async function handleStart() {
    if (mode === "url" && !url.trim()) return;
    if (mode === "file" && !file) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/blog/${templateId}/import`,
        mode === "url"
          ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceUrl: url }) }
          : { method: "POST", body: (() => { const f = new FormData(); f.append("file", file as File); return f; })() },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't start the import.");
        return;
      }
      setJob({ id: data.job.id, status: data.job.status, totalPosts: data.job.totalPosts, processedPosts: data.job.processedPosts, errors: [] });
    } finally {
      setStarting(false);
    }
  }

  const progressPct = job?.totalPosts ? Math.min(100, Math.round((job.processedPosts / job.totalPosts) * 100)) : job?.status === "COMPLETED" ? 100 : 0;

  return (
    <div style={{ padding: "2rem", maxWidth: 640, margin: "0 auto" }}>
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
          <p style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.75rem" }}>{STATUS_TEXT[job.status]}</p>
          <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden", marginBottom: "0.6rem" }}>
            <div style={{ height: "100%", width: `${progressPct}%`, background: "var(--brand)", transition: "width 0.4s" }} />
          </div>
          <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.5)", marginBottom: "1rem" }}>
            {job.processedPosts}
            {job.totalPosts ? ` / ${job.totalPosts}` : ""} posts imported
          </p>

          {job.status === "COMPLETED" && (
            <Link
              href={`/dashboard/templates/${templateId}/blog`}
              style={{ display: "inline-flex", padding: "0.55rem 1.1rem", borderRadius: 8, background: "var(--brand)", color: "#fff", fontSize: "0.82rem", fontWeight: 700, textDecoration: "none" }}
            >
              View your blog
            </Link>
          )}

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
    </div>
  );
}
