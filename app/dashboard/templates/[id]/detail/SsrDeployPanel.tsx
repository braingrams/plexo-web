"use client";

import { useState, type CSSProperties } from "react";
import { uploadSsrZip, queueSsrBuild } from "@/lib/projects/clientSsrUpload";

// The deploy section for a server-rendered (SSR) app. Replaces the static-site upload: the zip is a
// Next.js / Remix / Astro / Nuxt / Nitro project, built on the server, and goes live when published.

const card: CSSProperties = { border: "1px solid rgba(255,255,255,0.09)", borderRadius: 14, padding: "20px 22px", marginBottom: 16 };
const heading: CSSProperties = { margin: "0 0 4px", fontSize: 15, fontWeight: 700 };
const muted: CSSProperties = { margin: "0 0 14px", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 };
const button = (enabled: boolean): CSSProperties => ({
  padding: "8px 14px", borderRadius: 9, border: "none", fontWeight: 650, fontSize: 13,
  cursor: enabled ? "pointer" : "not-allowed", background: enabled ? "var(--brand)" : "rgba(255,255,255,0.08)", color: enabled ? "#fff" : "var(--text-muted)",
});

export function SsrDeployPanel({ templateId }: { templateId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<null | "upload" | "publish">(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy("upload"); setError(null); setNotice(null); setWarnings([]);
    const sent = await uploadSsrZip(templateId, file, (done, total) => setProgress(`Uploading ${done} of ${total}…`));
    if (!sent.ok) { setBusy(null); setProgress(null); return setError(sent.error); }
    setProgress("Queuing the build…");
    const queued = await queueSsrBuild(templateId, sent.data.uploadKey);
    setBusy(null); setProgress(null);
    if (!queued.ok) return setError(queued.error);
    setNotice(queued.data.message);
    setWarnings(queued.data.warnings);
    setFile(null);
  }

  async function publish() {
    if (!window.confirm("Publish the latest preview to the live site? The live site switches to it, and there's no rollback yet.")) return;
    setBusy("publish"); setError(null); setNotice(null); setWarnings([]);
    const res = await fetch(`/api/v1/templates/${templateId}/ssr-publish`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(data.error ?? `Publishing failed (server responded ${res.status}).`);
    setNotice(data.message ?? "Published to the live site.");
    setWarnings(data.warnings ?? []);
  }

  return (
    <div style={card}>
      <h3 style={heading}>Server app</h3>
      <p style={muted}>
        Upload the app's source as a .zip (package.json at the root, or inside one folder). Leave out node_modules, .git and build output.
        The server builds it. Publish the preview once the build succeeds to put it on the live site.
      </p>

      {error ? <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "#f87171" }}>{error}</p> : null}
      {notice ? <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--brand)" }}>{notice}</p> : null}
      {warnings.map((w) => (
        <p key={w} style={{ margin: "0 0 8px", fontSize: 12.5, color: "#fbbf24" }}>{w}</p>
      ))}
      {progress ? <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-muted)" }}>{progress}</p> : null}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="file"
          accept=".zip,application/zip"
          disabled={busy !== null}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          style={{ fontSize: 13 }}
        />
        <button type="button" onClick={() => void upload()} disabled={!file || busy !== null} style={button(!!file && busy === null)}>
          {busy === "upload" ? "Uploading…" : "Upload and build"}
        </button>
        <button type="button" onClick={() => void publish()} disabled={busy !== null} style={button(busy === null)}>
          {busy === "publish" ? "Publishing…" : "Publish preview"}
        </button>
      </div>
    </div>
  );
}
