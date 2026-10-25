"use client";

import { useRef, useState } from "react";
import { Card } from "../../../_components/Card";

type DeployedAppInfo = {
  framework: string;
  spaMode: boolean;
  updatedAt: string;
} | null;

type DeployResult = {
  framework: string;
  spaMode: boolean;
  fileCount: number;
  redirectRules: number;
  message: string;
};

const LABEL: React.CSSProperties = {
  fontSize: "0.82rem",
  color: "rgba(240,242,255,0.5)",
};
const VALUE: React.CSSProperties = {
  fontSize: "0.82rem",
  color: "#f0f2ff",
  fontWeight: 600,
};
const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: "0.5rem 1rem",
  padding: "0.7rem 0",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

function frameworkLabel(fw: string): string {
  const map: Record<string, string> = {
    "nextjs-export": "Next.js (static export)",
    "nuxt-static": "Nuxt (static generate)",
    "sveltekit-static": "SvelteKit (static)",
    "static-multipage": "Static multi-page",
    "spa": "Single-page app",
  };
  return map[fw] ?? fw;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function DeployPanel({
  templateId,
  initialDeployedApp,
  liveDomain,
}: {
  templateId: string;
  initialDeployedApp: DeployedAppInfo;
  liveDomain: string | null;
}) {
  const [deployedApp, setDeployedApp] = useState<DeployedAppInfo>(initialDeployedApp);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("Only .zip files are accepted.");
      return;
    }
    setError(null);
    setResult(null);
    setSelectedFile(file);
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }
  function onDragLeave() {
    setIsDragging(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  async function handleDeploy() {
    if (!selectedFile) return;
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      const res = await fetch(`/api/v1/templates/${templateId}/deploy`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({})) as DeployResult & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Deploy failed. Check the zip and try again.");
        return;
      }
      setResult(data);
      setSelectedFile(null);
      setDeployedApp({
        framework: data.framework,
        spaMode: data.spaMode,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  const dropZoneStyle: React.CSSProperties = {
    border: `1.5px dashed ${isDragging ? "#818cf8" : "rgba(255,255,255,0.14)"}`,
    borderRadius: 10,
    padding: "1.8rem 1rem",
    textAlign: "center",
    cursor: "pointer",
    background: isDragging ? "rgba(129,140,248,0.06)" : "transparent",
    transition: "border-color 0.15s, background 0.15s",
    marginTop: "1rem",
  };

  return (
    <Card>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.3rem",
        }}
      >
        <p style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>
          Deploy
        </p>
        {liveDomain && deployedApp && (
          <a
            href={`https://${liveDomain}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "0.35rem 0.75rem",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(240,242,255,0.85)",
              fontSize: "0.78rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Visit site →
          </a>
        )}
      </div>
      <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.45)", margin: "0 0 0.5rem" }}>
        Upload a pre-built framework app — Vite, Next.js (static export), Nuxt, Astro, etc.
        Zip the contents of your <code style={{ fontSize: "0.75rem", color: "#818cf8" }}>dist/</code> or{" "}
        <code style={{ fontSize: "0.75rem", color: "#818cf8" }}>out/</code> folder.
      </p>

      {/* Current deployment state */}
      {deployedApp && (
        <>
          <div style={{ ...ROW }}>
            <span style={LABEL}>Framework</span>
            <span style={VALUE}>{frameworkLabel(deployedApp.framework)}</span>
          </div>
          <div style={{ ...ROW }}>
            <span style={LABEL}>SPA routing</span>
            <span style={{ ...VALUE, color: deployedApp.spaMode ? "#4ade80" : "rgba(240,242,255,0.4)" }}>
              {deployedApp.spaMode ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div style={{ ...ROW }}>
            <span style={LABEL}>Last deployed</span>
            <span style={VALUE}>{formatRelative(deployedApp.updatedAt)}</span>
          </div>
        </>
      )}

      {/* Success banner */}
      {result && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem 1rem",
            borderRadius: 8,
            background: "rgba(74,222,128,0.08)",
            border: "1px solid rgba(74,222,128,0.2)",
            fontSize: "0.82rem",
            color: "#4ade80",
            lineHeight: 1.5,
          }}
        >
          {result.message}
          {result.redirectRules > 0 && ` · ${result.redirectRules} redirect rule${result.redirectRules !== 1 ? "s" : ""} applied.`}
        </div>
      )}

      {/* Drop zone */}
      <label
        style={dropZoneStyle}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".zip"
          style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)}
        />
        {selectedFile ? (
          <div>
            <div style={{ fontSize: "0.85rem", color: "#f0f2ff", fontWeight: 600, marginBottom: "0.25rem" }}>
              {selectedFile.name}
            </div>
            <div style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)" }}>
              {(selectedFile.size / 1024 / 1024).toFixed(1)} MB · Click to change
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.6)", marginBottom: "0.35rem" }}>
              Drop your zip here or click to browse
            </div>
            <div style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.3)" }}>
              .zip only · max 50 MB
            </div>
          </div>
        )}
      </label>

      {/* Error */}
      {error && (
        <div
          style={{
            marginTop: "0.75rem",
            fontSize: "0.8rem",
            color: "#f87171",
            padding: "0.6rem 0.9rem",
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: 8,
          }}
        >
          {error}
        </div>
      )}

      {/* Deploy button */}
      {selectedFile && (
        <button
          type="button"
          onClick={() => void handleDeploy()}
          disabled={uploading}
          style={{
            marginTop: "0.85rem",
            width: "100%",
            padding: "0.65rem",
            borderRadius: 8,
            border: "none",
            background: uploading ? "rgba(129,140,248,0.3)" : "#6366f1",
            color: "#fff",
            fontSize: "0.85rem",
            fontWeight: 700,
            cursor: uploading ? "not-allowed" : "pointer",
            letterSpacing: "0.02em",
            transition: "background 0.15s",
          }}
        >
          {uploading ? "Deploying…" : "Deploy"}
        </button>
      )}
    </Card>
  );
}
