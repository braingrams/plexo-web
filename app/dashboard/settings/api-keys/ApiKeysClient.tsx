"use client";

import { useState } from "react";
import { PageHeader } from "../../_components/PageHeader";
import type { SettingsApiKey } from "./page";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function IconKey() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconX() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function ApiKeysClient({ initialApiKeys }: { initialApiKeys: SettingsApiKey[] }) {
  const [apiKeys, setApiKeys] = useState<SettingsApiKey[]>(initialApiKeys);
  const [isGenerating, setIsGenerating] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generatedRawKey, setGeneratedRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingKeys, setRevokingKeys] = useState<Set<string>>(new Set());

  async function generateApiKey(): Promise<void> {
    setIsGenerating(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/settings/api-keys", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("Unable to generate a new API key.");
      const payload = (await response.json()) as { apiKey: SettingsApiKey; rawKey: string };
      setApiKeys((current) => [payload.apiKey, ...current]);
      setGeneratedRawKey(payload.rawKey);
      setCopied(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to generate a new API key.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function revokeKey(keyId: string): Promise<void> {
    setSaveError(null);
    setRevokingKeys((prev) => new Set(prev).add(keyId));
    try {
      const response = await fetch(`/api/settings/api-keys/${keyId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      if (!response.ok) throw new Error("Unable to revoke API key.");
      setApiKeys((current) => current.filter((item) => item.id !== keyId));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to revoke API key.");
    } finally {
      setRevokingKeys((prev) => {
        const next = new Set(prev);
        next.delete(keyId);
        return next;
      });
    }
  }

  async function copyRawKey(): Promise<void> {
    if (!generatedRawKey) return;
    await navigator.clipboard.writeText(generatedRawKey);
    setCopied(true);
  }

  return (
    <>
      <PageHeader eyebrow="Developer" title="API Keys" subtitle="Generate and manage the API keys your integrations authenticate with." />

      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.25rem", borderBottom: "1px solid rgba(255,255,255,0.06)", flexWrap: "wrap", gap: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--brand-subtle)", border: "1px solid rgba(139,92,246,0.2)", display: "grid", placeItems: "center", color: "var(--brand)", flexShrink: 0 }}>
              <IconKey />
            </div>
            <div>
              <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff" }}>API Key Management</h2>
              <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.35)" }}>{apiKeys.length} key{apiKeys.length !== 1 ? "s" : ""} total</p>
            </div>
          </div>
          <button
            id="generate-api-key-btn"
            type="button"
            onClick={() => void generateApiKey()}
            disabled={isGenerating}
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.5rem",
              padding: "0.5rem 0.9rem", borderRadius: 9, border: "none", cursor: isGenerating ? "not-allowed" : "pointer",
              fontSize: "0.78rem", fontWeight: 700, background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
              color: "#fff", opacity: isGenerating ? 0.7 : 1, boxShadow: "0 3px 14px var(--brand-glow)",
              fontFamily: "inherit", whiteSpace: "nowrap", marginLeft: "auto",
            }}
          >
            <IconKey />
            {isGenerating ? "Generating…" : "Generate Key"}
          </button>
        </div>

        <div style={{ width: "100%", overflowX: "auto" }} className="table-responsive-wrap">
          <table style={{ width: "100%", minWidth: 550, borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                {["Name", "Masked Key", "Created", "Status", "Action"].map((h) => (
                  <th key={h} style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600, fontSize: "0.7rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(240,242,255,0.35)", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {apiKeys.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "2.5rem", textAlign: "center", color: "rgba(240,242,255,0.35)", fontSize: "0.875rem" }}>
                    No API keys yet. Generate your first key to enable AI features.
                  </td>
                </tr>
              ) : (
                apiKeys.map((item) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "0.85rem 1.25rem", fontSize: "0.875rem", fontWeight: 600, color: "#f0f2ff" }}>{item.name}</td>
                    <td style={{ padding: "0.85rem 1.25rem", fontFamily: "monospace", fontSize: "0.8rem", color: "rgba(240,242,255,0.55)" }}>{item.maskedKey}</td>
                    <td style={{ padding: "0.85rem 1.25rem", color: "rgba(240,242,255,0.45)", fontSize: "0.8rem" }}>{formatDate(item.createdAt)}</td>
                    <td style={{ padding: "0.85rem 1.25rem" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.2rem 0.6rem", borderRadius: 999,
                        fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                        background: item.isActive ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
                        color: item.isActive ? "#34d399" : "#f87171",
                        border: `1px solid ${item.isActive ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}`,
                      }}>
                        {item.isActive ? <IconCheck /> : <IconX />}
                        {item.isActive ? "Active" : "Revoked"}
                      </span>
                    </td>
                    <td style={{ padding: "0.85rem 1.25rem" }}>
                      <button
                        type="button"
                        disabled={!item.isActive || revokingKeys.has(item.id)}
                        onClick={() => void revokeKey(item.id)}
                        style={{
                          padding: "0.4rem 0.85rem", borderRadius: 7, border: "1px solid rgba(248,113,113,0.25)",
                          background: "transparent", color: "#f87171", fontSize: "0.75rem", fontWeight: 600,
                          cursor: (item.isActive && !revokingKeys.has(item.id)) ? "pointer" : "not-allowed",
                          opacity: (item.isActive && !revokingKeys.has(item.id)) ? 1 : 0.4,
                          fontFamily: "inherit", transition: "background 0.15s",
                        }}
                      >
                        {revokingKeys.has(item.id) ? "Revoking..." : "Revoke"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {saveError && <p style={{ fontSize: "0.78rem", color: "#f87171", marginTop: "0.75rem" }}>{saveError}</p>}

      {generatedRawKey && (
        <div role="dialog" aria-modal="true" aria-labelledby="key-modal-title" style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", padding: "1rem" }}>
          <div style={{ width: "min(100%,480px)", background: "#0d0f1a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "1.75rem", boxShadow: "0 30px 100px rgba(0,0,0,0.7), 0 0 0 1px rgba(139,92,246,0.08)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.5rem" }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--brand-subtle)", border: "1px solid rgba(139,92,246,0.25)", display: "grid", placeItems: "center", color: "var(--brand)" }}>
                <IconKey />
              </div>
              <h3 id="key-modal-title" style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.1rem", fontWeight: 700, color: "#f0f2ff" }}>Your New API Key</h3>
            </div>
            <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.45)", marginBottom: "1.25rem" }}>
              This is the only time the full key will be shown. Copy and store it securely.
            </p>
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 10, padding: "0.9rem 1rem", fontFamily: "monospace", fontSize: "0.82rem", color: "var(--brand)", wordBreak: "break-all", marginBottom: "1.25rem" }}>
              {generatedRawKey}
            </div>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                id="copy-key-btn"
                type="button"
                onClick={() => void copyRawKey()}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", padding: "0.7rem",
                  borderRadius: 9, border: "none", cursor: "pointer",
                  background: copied ? "rgba(52,211,153,0.15)" : "linear-gradient(135deg,var(--brand),var(--brand-deep))",
                  color: copied ? "#34d399" : "#fff", fontFamily: "inherit", fontSize: "0.875rem", fontWeight: 700, transition: "all 0.2s",
                }}
              >
                {copied ? <IconCheck /> : <IconCopy />}
                {copied ? "Copied!" : "Copy to Clipboard"}
              </button>
              <button
                type="button"
                onClick={() => { setGeneratedRawKey(null); setCopied(false); }}
                style={{ padding: "0.7rem 1.1rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(240,242,255,0.65)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.875rem", fontWeight: 600 }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
