"use client";

import { useRef, useState } from "react";
import { Card } from "../../../_components/Card";
import { BRAND } from "@/lib/theme";

type HostingTier = "STATIC" | "LAMBDA" | "PROVISIONED";

type DeployedAppInfo = {
  framework: string;
  spaMode: boolean;
  updatedAt: string;
  hostingTier: string;
  allowedTiers: string[];
} | null;

type DeployResult = {
  framework: string;
  spaMode: boolean;
  hostingTier: string;
  fileCount: number;
  redirectRules: number;
  message: string;
};

const LABEL: React.CSSProperties = {
  fontSize: "0.82rem",
  color: "var(--plx-muted, rgba(240,242,255,0.5))",
};
const VALUE: React.CSSProperties = {
  fontSize: "0.82rem",
  color: "var(--plx-text, #f0f2ff)",
  fontWeight: 600,
};
const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: "0.5rem 1rem",
  padding: "0.7rem 0",
  borderBottom: "1px solid color-mix(in srgb, var(--plx-text, #fff) 6%, transparent)",
};

const TIER_META: Record<HostingTier, { label: string; description: string; color: string }> = {
  STATIC: {
    label: "Static",
    description: "Served directly from S3. Cheapest — best for low-traffic sites.",
    color: "#60a5fa",
  },
  LAMBDA: {
    label: "Lambda",
    description: "On-demand compute. Occasional cold starts; good for most sites.",
    color: BRAND[400],
  },
  PROVISIONED: {
    label: "Provisioned",
    description: "Always-warm Lambda. No cold starts — consistent performance.",
    color: "var(--plx-success, #34d399)",
  },
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
  const [tierChanging, setTierChanging] = useState(false);
  const [tierError, setTierError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [chunkProgress, setChunkProgress] = useState<{ current: number; total: number } | null>(null);

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
    setChunkProgress(null);
    try {
      const currentTier = deployedApp?.hostingTier ?? "LAMBDA";
      const CHUNK_SIZE = 3 * 1024 * 1024; // 3 MB → base64 ≈ 4 MB → under Lambda's 6 MB limit
      const chunkTotal = Math.ceil(selectedFile.size / CHUNK_SIZE);
      const uploadSession = crypto.randomUUID();

      let finalData: DeployResult | null = null;
      for (let i = 0; i < chunkTotal; i++) {
        setChunkProgress({ current: i + 1, total: chunkTotal });
        const start = i * CHUNK_SIZE;
        const chunk = selectedFile.slice(start, start + CHUNK_SIZE);
        const res = await fetch(`/api/v1/templates/${templateId}/deploy/chunk?hostingTier=${currentTier}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Upload-Session": uploadSession,
            "X-Chunk-Index": String(i),
            "X-Chunk-Total": String(chunkTotal),
          },
          body: chunk,
        });
        const data = await res.json().catch(() => ({})) as DeployResult & { error?: string };
        if (!res.ok) {
          setError(data.error ?? "Deploy failed. Check the zip and try again.");
          return;
        }
        if (i === chunkTotal - 1) finalData = data;
      }

      if (finalData) {
        setResult(finalData);
        setSelectedFile(null);
        setDeployedApp((prev) => ({
          framework: finalData.framework,
          spaMode: finalData.spaMode,
          updatedAt: new Date().toISOString(),
          hostingTier: finalData.hostingTier,
          allowedTiers: prev?.allowedTiers ?? ["STATIC", "LAMBDA"],
        }));
      }
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setUploading(false);
      setChunkProgress(null);
    }
  }

  async function handleTierChange(tier: HostingTier) {
    if (!deployedApp || tier === deployedApp.hostingTier) return;
    setTierChanging(true);
    setTierError(null);
    try {
      const res = await fetch(`/api/v1/templates/${templateId}/deploy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostingTier: tier }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setTierError(data.error ?? "Failed to change hosting tier.");
        return;
      }
      setDeployedApp((prev) => prev ? { ...prev, hostingTier: tier } : prev);
    } catch {
      setTierError("Network error. Check your connection and try again.");
    } finally {
      setTierChanging(false);
    }
  }

  const dropZoneStyle: React.CSSProperties = {
    border: `1.5px dashed ${isDragging ? "var(--plx-violet, #818cf8)" : "color-mix(in srgb, var(--plx-text, #fff) 14%, transparent)"}`,
    borderRadius: 10,
    padding: "1.8rem 1rem",
    textAlign: "center",
    cursor: "pointer",
    background: isDragging ? "color-mix(in srgb, var(--plx-violet, rgb(129 140 248)) 6%, transparent)" : "transparent",
    transition: "border-color 0.15s, background 0.15s",
    marginTop: "1rem",
  };

  const currentTier = (deployedApp?.hostingTier ?? "LAMBDA") as HostingTier;
  const allowedTiers = (deployedApp?.allowedTiers ?? ["STATIC", "LAMBDA"]) as HostingTier[];
  const allTiers: HostingTier[] = ["STATIC", "LAMBDA", "PROVISIONED"];

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
        <p style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--plx-text, #f0f2ff)", margin: 0 }}>
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
              border: "1px solid color-mix(in srgb, var(--plx-text, #fff) 12%, transparent)",
              color: "var(--plx-text, rgba(240,242,255,0.85))",
              fontSize: "0.78rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Visit site →
          </a>
        )}
      </div>
      <p style={{ fontSize: "0.8rem", color: "var(--plx-muted, rgba(240,242,255,0.45))", margin: "0 0 0.5rem" }}>
        Upload a pre-built framework app — Vite, Next.js (static export), Nuxt, Astro, etc.
        Zip the contents of your <code style={{ fontSize: "0.75rem", color: "var(--plx-violet, #818cf8)" }}>dist/</code> or{" "}
        <code style={{ fontSize: "0.75rem", color: "var(--plx-violet, #818cf8)" }}>out/</code> folder.
      </p>

      {deployedApp && (
        <>
          <div style={{ ...ROW }}>
            <span style={LABEL}>Framework</span>
            <span style={VALUE}>{frameworkLabel(deployedApp.framework)}</span>
          </div>
          <div style={{ ...ROW }}>
            <span style={LABEL}>SPA routing</span>
            <span style={{ ...VALUE, color: deployedApp.spaMode ? "var(--plx-success, #4ade80)" : "color-mix(in srgb, var(--plx-text, rgb(240 242 255)) 40%, transparent)" }}>
              {deployedApp.spaMode ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div style={{ ...ROW }}>
            <span style={LABEL}>Last deployed</span>
            <span style={VALUE}>{formatRelative(deployedApp.updatedAt)}</span>
          </div>

          <div style={{ padding: "0.9rem 0 0.4rem" }}>
            <span style={{ ...LABEL, display: "block", marginBottom: "0.6rem" }}>Hosting tier</span>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
              {allTiers.map((tier) => {
                const meta = TIER_META[tier];
                const isActive = tier === currentTier;
                const isAllowed = allowedTiers.includes(tier);
                return (
                  <button
                    key={tier}
                    type="button"
                    disabled={!isAllowed || isActive || tierChanging}
                    onClick={() => void handleTierChange(tier)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.6rem 0.85rem",
                      borderRadius: 8,
                      border: isActive
                        ? `1.5px solid ${meta.color}`
                        : "1.5px solid color-mix(in srgb, var(--plx-text, #fff) 8%, transparent)",
                      background: isActive
                        ? `${meta.color}14`
                        : isAllowed
                        ? "transparent"
                        : "color-mix(in srgb, var(--plx-text, #fff) 2%, transparent)",
                      cursor: isActive || !isAllowed || tierChanging ? "default" : "pointer",
                      textAlign: "left",
                      opacity: !isAllowed ? 0.45 : 1,
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: isActive ? meta.color : "var(--plx-faint, rgba(255,255,255,0.2))",
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: "0.8rem",
                          fontWeight: 700,
                          color: isActive ? meta.color : "var(--plx-text, rgba(240,242,255,0.8))",
                        }}
                      >
                        {meta.label}
                        {!isAllowed && (
                          <span style={{ marginLeft: "0.4rem", fontSize: "0.68rem", fontWeight: 600, color: "var(--plx-faint, rgba(240,242,255,0.3))" }}>
                            Upgrade required
                          </span>
                        )}
                      </span>
                      <span style={{ display: "block", fontSize: "0.73rem", color: "var(--plx-faint, rgba(240,242,255,0.38))", marginTop: "0.1rem" }}>
                        {meta.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {tierError && (
              <div
                style={{
                  marginTop: "0.6rem",
                  fontSize: "0.78rem",
                  color: "var(--plx-danger, #f87171)",
                  padding: "0.5rem 0.75rem",
                  background: "color-mix(in srgb, var(--plx-danger, rgb(248 113 113)) 8%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--plx-danger, rgb(248 113 113)) 20%, transparent)",
                  borderRadius: 8,
                }}
              >
                {tierError}
              </div>
            )}
          </div>
        </>
      )}

      {result && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem 1rem",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--plx-success, rgb(74 222 128)) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--plx-success, rgb(74 222 128)) 20%, transparent)",
            fontSize: "0.82rem",
            color: "var(--plx-success, #4ade80)",
            lineHeight: 1.5,
          }}
        >
          {result.message}
          {result.redirectRules > 0 && ` · ${result.redirectRules} redirect rule${result.redirectRules !== 1 ? "s" : ""} applied.`}
        </div>
      )}

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
            <div style={{ fontSize: "0.85rem", color: "var(--plx-text, #f0f2ff)", fontWeight: 600, marginBottom: "0.25rem" }}>
              {selectedFile.name}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--plx-muted, rgba(240,242,255,0.4))" }}>
              {(selectedFile.size / 1024 / 1024).toFixed(1)} MB · Click to change
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: "0.85rem", color: "var(--plx-muted, rgba(240,242,255,0.6))", marginBottom: "0.35rem" }}>
              Drop your zip here or click to browse
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--plx-faint, rgba(240,242,255,0.3))" }}>
              .zip only · max 50 MB
            </div>
          </div>
        )}
      </label>

      {error && (
        <div
          style={{
            marginTop: "0.75rem",
            fontSize: "0.8rem",
            color: "var(--plx-danger, #f87171)",
            padding: "0.6rem 0.9rem",
            background: "color-mix(in srgb, var(--plx-danger, rgb(248 113 113)) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--plx-danger, rgb(248 113 113)) 20%, transparent)",
            borderRadius: 8,
          }}
        >
          {error}
        </div>
      )}

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
            background: uploading ? "color-mix(in srgb, var(--plx-violet, rgb(129 140 248)) 30%, transparent)" : "var(--plx-violet, #6366f1)",
            color: "var(--plx-text, #fff)",
            fontSize: "0.85rem",
            fontWeight: 700,
            cursor: uploading ? "not-allowed" : "pointer",
            letterSpacing: "0.02em",
            transition: "background 0.15s",
          }}
        >
          {uploading
            ? chunkProgress && chunkProgress.total > 1
              ? `Uploading ${chunkProgress.current} of ${chunkProgress.total}…`
              : "Deploying…"
            : "Deploy"}
        </button>
      )}
    </Card>
  );
}
