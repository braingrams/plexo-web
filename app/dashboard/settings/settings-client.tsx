"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../_components/PageHeader";

type AiTier = "AUTO" | "BASIC" | "MEDIUM" | "HIGH";
type Provider = "openai" | "anthropic_claude" | "google_gemini";
type SettingsApiKey = {
  id: string;
  name: string;
  maskedKey: string;
  createdAt: string;
  isActive: boolean;
  useAi: boolean;
  aiProvider: string;
  aiTier: AiTier;
  aiApiKey: string | null;
};

type Props = {
  initialApiKeys: SettingsApiKey[];
};

const PROVIDER_OPTIONS: Array<{ label: string; value: Provider }> = [
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic / Claude", value: "anthropic_claude" },
  { label: "Google Gemini", value: "google_gemini" },
];

const TIER_OPTIONS: Array<{ label: string; value: AiTier; desc: string }> = [
  { label: "Base", value: "BASIC", desc: "Strict, deterministic outputs" },
  { label: "Medium", value: "MEDIUM", desc: "Balanced creativity" },
  { label: "High", value: "HIGH", desc: "Creative & exploratory" },
  { label: "Auto", value: "AUTO", desc: "System default" },
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function normalizeProvider(value: string): Provider {
  if (value === "anthropic_claude" || value.toLowerCase().includes("claude")) return "anthropic_claude";
  if (value === "google_gemini" || value.toLowerCase().includes("gemini")) return "google_gemini";
  return "openai";
}

function IconKey() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5"/>
      <path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>
    </svg>
  );
}

function IconCopy() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function IconX() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}

function CustomSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: Array<{ label: string; value: string }>;
  disabled?: boolean;
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          padding: "0.6rem 0.875rem",
          borderRadius: 9,
          border: open ? "1px solid rgba(139,92,246,0.5)" : "1px solid rgba(255,255,255,0.1)",
          background: open ? "rgba(139,92,246,0.08)" : "rgba(255,255,255,0.05)",
          color: disabled ? "rgba(240,242,255,0.3)" : "rgba(240,242,255,0.9)",
          fontFamily: "inherit",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "border-color 0.15s, background 0.15s",
          boxShadow: open ? "0 0 0 2px rgba(139,92,246,0.15)" : "none",
        }}
      >
        <span>{selected?.label ?? value}</span>
        <span style={{ color: "rgba(240,242,255,0.4)", transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "inline-flex" }}>
          <IconChevronDown />
        </span>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 99 }}
            onClick={() => setOpen(false)}
          />
          {/* Dropdown panel */}
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0, right: 0,
              zIndex: 100,
              background: "rgba(18,16,36,0.95)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(139,92,246,0.3)",
              borderRadius: 10,
              overflow: "hidden",
              boxShadow: "0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(139,92,246,0.15)",
            }}
          >
            {options.map((opt) => {
              const isActive = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.625rem 0.875rem",
                    background: isActive ? "rgba(139,92,246,0.12)" : "transparent",
                    border: "none",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    color: isActive ? "#c4b5fd" : "rgba(240,242,255,0.75)",
                    fontFamily: "inherit",
                    fontSize: "0.875rem",
                    fontWeight: isActive ? 600 : 400,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.1s, color 0.1s",
                  }}
                  onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; }}
                  onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <span>{opt.label}</span>
                  {isActive && <span style={{ color: "#8b5cf6", display: "inline-flex" }}><IconCheck /></span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function SettingsClient({ initialApiKeys }: Props) {
  const [apiKeys, setApiKeys] = useState<SettingsApiKey[]>(initialApiKeys);
  const [activeKeyId, setActiveKeyId] = useState<string | null>(
    initialApiKeys.find((item) => item.isActive)?.id ?? initialApiKeys[0]?.id ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedRawKey, setGeneratedRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const activeKey = useMemo(
    () => apiKeys.find((item) => item.id === activeKeyId) ?? null,
    [apiKeys, activeKeyId],
  );

  const [draftUseAi, setDraftUseAi] = useState<boolean>(activeKey?.useAi ?? false);
  const [draftAiProvider, setDraftAiProvider] = useState<Provider>(
    normalizeProvider(activeKey?.aiProvider ?? "openai"),
  );
  const [draftAiTier, setDraftAiTier] = useState<AiTier>(activeKey?.aiTier ?? "AUTO");
  const [draftAiApiKey, setDraftAiApiKey] = useState<string>(activeKey?.aiApiKey ?? "");
  const [draftDirty, setDraftDirty] = useState(false);

  useEffect(() => {
    if (!activeKeyId) {
      setDraftUseAi(false); setDraftAiProvider("openai"); setDraftAiTier("AUTO"); setDraftAiApiKey(""); setDraftDirty(false); return;
    }
    const selected = apiKeys.find((item) => item.id === activeKeyId);
    if (!selected) {
      setDraftUseAi(false); setDraftAiProvider("openai"); setDraftAiTier("AUTO"); setDraftAiApiKey(""); setDraftDirty(false); return;
    }
    setDraftUseAi(selected.useAi);
    setDraftAiProvider(normalizeProvider(selected.aiProvider));
    setDraftAiTier(selected.aiTier);
    setDraftAiApiKey(selected.aiApiKey ?? "");
    setDraftDirty(false);
  }, [activeKeyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!draftDirty || !activeKey) return;
    const timer = window.setTimeout(async () => {
      setSaving(true); setSaveError(null); setSaveNotice(null);
      try {
        const response = await fetch(`/api/settings/api-keys/${activeKey.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            useAi: draftUseAi,
            aiProvider: draftAiProvider,
            aiTier: draftAiTier,
            aiApiKey: draftAiApiKey || null
          }),
        });
        if (!response.ok) throw new Error("Unable to persist AI configuration.");
        const payload = (await response.json()) as { apiKey: SettingsApiKey };
        setApiKeys((current) => current.map((item) => (item.id === payload.apiKey.id ? payload.apiKey : item)));
        setSaveNotice("AI settings saved.");
        setDraftDirty(false);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Unable to persist AI configuration.");
      } finally {
        setSaving(false);
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [activeKey, draftAiProvider, draftAiTier, draftDirty, draftUseAi, draftAiApiKey]);

  async function generateApiKey(): Promise<void> {
    setIsGenerating(true); setSaveError(null);
    try {
      const response = await fetch("/api/settings/api-keys", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("Unable to generate a new API key.");
      const payload = (await response.json()) as { apiKey: SettingsApiKey; rawKey: string };
      setApiKeys((current) => [payload.apiKey, ...current]);
      setActiveKeyId(payload.apiKey.id);
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
    try {
      const response = await fetch(`/api/settings/api-keys/${keyId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      if (!response.ok) throw new Error("Unable to revoke API key.");
      const payload = (await response.json()) as { apiKey: SettingsApiKey };
      setApiKeys((current) => {
        const nextState = current.map((item) => (item.id === payload.apiKey.id ? payload.apiKey : item));
        if (activeKeyId === payload.apiKey.id && !payload.apiKey.isActive) {
          const nextActive = nextState.find((item) => item.id !== payload.apiKey.id && item.isActive);
          setActiveKeyId(nextActive?.id ?? null);
        }
        return nextState;
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to revoke API key.");
    }
  }

  async function copyRawKey(): Promise<void> {
    if (!generatedRawKey) return;
    await navigator.clipboard.writeText(generatedRawKey);
    setCopied(true);
  }

  function formatDate(iso: string): string {
    const date = new Date(iso);
    return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  }

  return (
    <>
      <PageHeader
        eyebrow="Developer"
        title="Settings"
        subtitle="Manage API credentials and global AI proxy configuration."
      />

      <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "1fr" }}>

        {/* ── API KEY MANAGEMENT ─────────────────── */}
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16, overflow: "hidden",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "1.25rem 1.5rem",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <div style={{
                width: 34, height: 34, borderRadius: 9,
                background: "var(--brand-subtle)", border: "1px solid rgba(139,92,246,0.2)",
                display: "grid", placeItems: "center", color: "var(--brand)",
              }}>
                <IconKey />
              </div>
              <div>
                <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700, color: "#f0f2ff" }}>
                  API Key Management
                </h2>
                <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.35)" }}>
                  {apiKeys.length} key{apiKeys.length !== 1 ? "s" : ""} total
                </p>
              </div>
            </div>
            <button
              id="generate-api-key-btn"
              type="button"
              onClick={() => void generateApiKey()}
              disabled={isGenerating}
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.5rem",
                padding: "0.55rem 1rem",
                borderRadius: 9, border: "none", cursor: isGenerating ? "not-allowed" : "pointer",
                fontSize: "0.8rem", fontWeight: 700,
                background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
                color: "#fff", opacity: isGenerating ? 0.7 : 1,
                boxShadow: "0 3px 14px var(--brand-glow)",
                fontFamily: "inherit",
              }}
            >
              <IconKey />
              {isGenerating ? "Generating…" : "Generate Key"}
            </button>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  {["Name", "Masked Key", "Created", "Status", "Action"].map((h) => (
                    <th key={h} style={{
                      padding: "0.75rem 1.25rem",
                      textAlign: "left", fontWeight: 600, fontSize: "0.72rem",
                      letterSpacing: "0.08em", textTransform: "uppercase",
                      color: "rgba(240,242,255,0.35)",
                    }}>
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
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                        background: activeKeyId === item.id ? "var(--brand-subtle)" : "transparent",
                        transition: "background 0.15s",
                      }}
                    >
                      <td style={{ padding: "0.85rem 1.25rem" }}>
                        <button
                          type="button"
                          onClick={() => setActiveKeyId(item.id)}
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            fontFamily: "inherit", fontSize: "0.875rem",
                            fontWeight: 600, color: activeKeyId === item.id ? "var(--brand)" : "#f0f2ff",
                            textAlign: "left", padding: 0,
                          }}
                        >
                          {item.name}
                        </button>
                      </td>
                      <td style={{ padding: "0.85rem 1.25rem", fontFamily: "monospace", fontSize: "0.8rem", color: "rgba(240,242,255,0.55)" }}>
                        {item.maskedKey}
                      </td>
                      <td style={{ padding: "0.85rem 1.25rem", color: "rgba(240,242,255,0.45)", fontSize: "0.8rem" }}>
                        {formatDate(item.createdAt)}
                      </td>
                      <td style={{ padding: "0.85rem 1.25rem" }}>
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: "0.3rem",
                          padding: "0.2rem 0.6rem", borderRadius: 999,
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
                          disabled={!item.isActive}
                          onClick={() => void revokeKey(item.id)}
                          style={{
                            padding: "0.4rem 0.85rem",
                            borderRadius: 7,
                            border: "1px solid rgba(248,113,113,0.25)",
                            background: "transparent",
                            color: "#f87171", fontSize: "0.75rem", fontWeight: 600,
                            cursor: item.isActive ? "pointer" : "not-allowed",
                            opacity: item.isActive ? 1 : 0.4,
                            fontFamily: "inherit",
                            transition: "background 0.15s",
                          }}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── AI CONFIGURATION ───────────────────── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "1.5rem",
        }}>
          <div style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16, padding: "1.5rem",
          }}>
            <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.35rem" }}>
              AI Configuration
            </h2>
            <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.35)", marginBottom: "1.25rem" }}>
              Changes auto-save for the selected API key.
            </p>

            {!activeKey ? (
              <div style={{
                padding: "1.25rem",
                borderRadius: 12,
                background: "rgba(255,255,255,0.03)",
                border: "1px dashed rgba(255,255,255,0.1)",
                textAlign: "center",
                color: "rgba(240,242,255,0.35)", fontSize: "0.875rem",
              }}>
                Select an active API key to configure AI settings.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
                {/* Use AI Toggle */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "0.9rem 1rem",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 11,
                }}>
                  <div>
                    <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "#f0f2ff" }}>Use AI</p>
                    <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.35)" }}>Enable AI proxy for this token</p>
                  </div>
                  {/* Custom Toggle */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draftUseAi}
                    id="toggle-use-ai"
                    disabled={!activeKey.isActive}
                    onClick={() => {
                      const next = !draftUseAi;
                      setDraftUseAi(next);
                      setDraftDirty(true);
                      setApiKeys((current) => current.map((item) => (item.id === activeKey.id ? { ...item, useAi: next } : item)));
                    }}
                    style={{
                      position: "relative",
                      width: 44, height: 24,
                      borderRadius: 999,
                      background: draftUseAi ? "var(--brand)" : "rgba(255,255,255,0.1)",
                      border: draftUseAi ? "1px solid var(--brand)" : "1px solid rgba(255,255,255,0.12)",
                      cursor: activeKey.isActive ? "pointer" : "not-allowed",
                      opacity: activeKey.isActive ? 1 : 0.5,
                      transition: "background 0.2s, border-color 0.2s",
                      flexShrink: 0,
                    }}
                  >
                    <span style={{
                      position: "absolute",
                      top: 3, left: draftUseAi ? 22 : 3,
                      width: 16, height: 16, borderRadius: "50%",
                      background: "#fff",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                      transition: "left 0.2s cubic-bezier(0.4,0,0.2,1)",
                    }} />
                  </button>
                </div>

                {draftUseAi && (
                  <>
                    {/* Provider */}
                    <div>
                      <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.4)", marginBottom: "0.4rem" }}>
                        AI Provider
                      </span>
                      <CustomSelect
                        value={draftAiProvider}
                        options={PROVIDER_OPTIONS}
                        disabled={!activeKey.isActive}
                        onChange={(next) => {
                          const v = next as Provider;
                          setDraftAiProvider(v);
                          setDraftDirty(true);
                          setApiKeys((current) => current.map((item) => (item.id === activeKey.id ? { ...item, aiProvider: v } : item)));
                        }}
                      />
                    </div>

                    {/* Tier */}
                    <div>
                      <p style={{ fontSize: "0.78rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.4)", marginBottom: "0.5rem" }}>
                        Creativity Tier
                      </p>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                        {TIER_OPTIONS.map((tier) => {
                          const active = draftAiTier === tier.value;
                          const isBtnDisabled = !activeKey.isActive;
                          return (
                            <button
                              key={tier.value}
                              id={`tier-${tier.value.toLowerCase()}`}
                              type="button"
                              disabled={isBtnDisabled}
                              onClick={() => {
                                setDraftAiTier(tier.value);
                                setDraftDirty(true);
                                setApiKeys((current) => current.map((item) => (item.id === activeKey.id ? { ...item, aiTier: tier.value } : item)));
                              }}
                              style={{
                                padding: "0.65rem 0.75rem",
                                borderRadius: 9,
                                border: active ? "1.5px solid rgba(139,92,246,0.4)" : "1px solid rgba(255,255,255,0.08)",
                                background: active ? "rgba(139,92,246,0.1)" : "rgba(255,255,255,0.03)",
                                color: active ? "#c4b5fd" : "rgba(240,242,255,0.55)",
                                cursor: isBtnDisabled ? "not-allowed" : "pointer",
                                fontFamily: "inherit", textAlign: "left",
                                transition: "all 0.15s",
                                opacity: isBtnDisabled && !active ? 0.5 : 1,
                              }}
                            >
                              <p style={{ fontSize: "0.8rem", fontWeight: active ? 700 : 600 }}>{tier.label}</p>
                              <p style={{ fontSize: "0.68rem", color: active ? "rgba(196,181,253,0.7)" : "rgba(240,242,255,0.3)" }}>{tier.desc}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* AI API Key Field */}
                    <div>
                      <span style={{
                        display: "block", fontSize: "0.78rem", fontWeight: 600,
                        letterSpacing: "0.06em", textTransform: "uppercase",
                        color: "rgba(240,242,255,0.4)",
                        marginBottom: "0.4rem"
                      }}>
                        AI API Key
                      </span>
                      <input
                        type="password"
                        placeholder="Enter your AI provider API key"
                        value={draftAiApiKey}
                        disabled={!activeKey.isActive}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraftAiApiKey(v);
                          setDraftDirty(true);
                        }}
                        style={{
                          width: "100%",
                          padding: "0.6rem 0.875rem",
                          borderRadius: 9,
                          border: "1px solid rgba(255,255,255,0.1)",
                          background: "rgba(255,255,255,0.05)",
                          color: "rgba(240,242,255,0.9)",
                          fontFamily: "inherit",
                          fontSize: "0.875rem",
                          outline: "none",
                          cursor: "text",
                          transition: "border-color 0.15s",
                        }}
                      />
                      <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.3)", marginTop: "0.3rem" }}>
                        This API key will be used dynamically when querying the builder AI functions.
                      </p>
                    </div>
                  </>
                )}

                {/* Status */}
                {saving && <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.45)" }}>Saving…</p>}
                {saveNotice && <p style={{ fontSize: "0.78rem", color: "#34d399" }}>{saveNotice}</p>}
                {saveError && <p style={{ fontSize: "0.78rem", color: "#f87171" }}>{saveError}</p>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── RAW KEY MODAL ───────────────────────── */}
      {generatedRawKey && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="key-modal-title"
          style={{
            position: "fixed", inset: 0, zIndex: 50,
            display: "grid", placeItems: "center",
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            padding: "1rem",
          }}
        >
          <div style={{
            width: "min(100%,480px)",
            background: "#0d0f1a",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 20, padding: "1.75rem",
            boxShadow: "0 30px 100px rgba(0,0,0,0.7), 0 0 0 1px rgba(139,92,246,0.08)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.5rem" }}>
              <div style={{
                width: 34, height: 34, borderRadius: 9,
                background: "var(--brand-subtle)", border: "1px solid rgba(139,92,246,0.25)",
                display: "grid", placeItems: "center", color: "var(--brand)",
              }}>
                <IconKey />
              </div>
              <h3 id="key-modal-title" style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.1rem", fontWeight: 700, color: "#f0f2ff" }}>
                Your New API Key
              </h3>
            </div>
            <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.45)", marginBottom: "1.25rem" }}>
              This is the only time the full key will be shown. Copy and store it securely.
            </p>

            <div style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(139,92,246,0.2)",
              borderRadius: 10, padding: "0.9rem 1rem",
              fontFamily: "monospace", fontSize: "0.82rem",
              color: "var(--brand)", wordBreak: "break-all",
              marginBottom: "1.25rem",
            }}>
              {generatedRawKey}
            </div>

            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                id="copy-key-btn"
                type="button"
                onClick={() => void copyRawKey()}
                style={{
                  flex: 1,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                  padding: "0.7rem",
                  borderRadius: 9, border: "none", cursor: "pointer",
                  background: copied ? "rgba(52,211,153,0.15)" : "linear-gradient(135deg,var(--brand),var(--brand-deep))",
                  color: copied ? "#34d399" : "#fff",
                  fontFamily: "inherit", fontSize: "0.875rem", fontWeight: 700,
                  transition: "all 0.2s",
                }}
              >
                {copied ? <IconCheck /> : <IconCopy />}
                {copied ? "Copied!" : "Copy to Clipboard"}
              </button>
              <button
                type="button"
                onClick={() => { setGeneratedRawKey(null); setCopied(false); }}
                style={{
                  padding: "0.7rem 1.1rem",
                  borderRadius: 9,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "transparent", color: "rgba(240,242,255,0.65)",
                  cursor: "pointer", fontFamily: "inherit", fontSize: "0.875rem", fontWeight: 600,
                }}
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
