"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../_components/PageHeader";
import { BillingSection } from "./billing-section";

type AiTier = "AUTO" | "BASIC" | "MEDIUM" | "HIGH";
type Provider = "openai" | "anthropic_claude" | "google_gemini";
type AiAccessMode = "SYSTEM" | "BYOK" | "HOST_MANAGED";
type SettingsApiKey = {
  id: string;
  name: string;
  maskedKey: string;
  createdAt: string;
  isActive: boolean;
  useAi: boolean;
  aiProvider: string;
  aiTier: AiTier;
  hasAiApiKey: boolean;
  aiAccessMode: AiAccessMode;
  hostAuthWebhookUrl: string | null;
  hasHostWebhookSecret: boolean;
};

const ACCESS_MODE_OPTIONS: Array<{ value: AiAccessMode; label: string; desc: string }> = [
  { value: "SYSTEM", label: "System AI", desc: "Plexo's own credit balance pays" },
  { value: "BYOK", label: "Bring Your Own Key", desc: "Your own provider key pays, no credits used" },
  { value: "HOST_MANAGED", label: "Host-Managed", desc: "Your app authorizes & bills its own users" },
];

type BillingProps = {
  plan: "FREE" | "PRO" | "ULTRA";
  allowanceBalance: number;
  topupBalance: number;
  allowanceResetAt: string;
  recentActivity: Array<{
    id: string;
    type: "MONTHLY_GRANT" | "TOPUP_PURCHASE" | "AI_USAGE" | "REFUND" | "ADJUSTMENT";
    amount: number;
    description: string | null;
    createdAt: string;
  }>;
};

type Props = {
  initialApiKeys: SettingsApiKey[];
  initialManageLandingPagePublishing: boolean;
  billing: BillingProps;
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

export function SettingsClient({ initialApiKeys, initialManageLandingPagePublishing, billing }: Props) {
  const [apiKeys, setApiKeys] = useState<SettingsApiKey[]>(initialApiKeys);
  const isUltra = billing.plan === "ULTRA";
  const [manageLandingPagePublishing, setManageLandingPagePublishing] = useState<boolean>(initialManageLandingPagePublishing);
  const [publishSettingSaving, setPublishSettingSaving] = useState(false);
  const [publishSettingError, setPublishSettingError] = useState<string | null>(null);
  const [activeKeyId, setActiveKeyId] = useState<string | null>(
    initialApiKeys.find((item) => item.isActive)?.id ?? initialApiKeys[0]?.id ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedRawKey, setGeneratedRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingKeys, setRevokingKeys] = useState<Set<string>>(new Set());

  const activeKey = useMemo(
    () => apiKeys.find((item) => item.id === activeKeyId) ?? null,
    [apiKeys, activeKeyId],
  );

  const [draftUseAi, setDraftUseAi] = useState<boolean>(activeKey?.useAi ?? false);
  const [draftAiProvider, setDraftAiProvider] = useState<Provider>(
    normalizeProvider(activeKey?.aiProvider ?? "openai"),
  );
  const [draftAiTier, setDraftAiTier] = useState<AiTier>(activeKey?.aiTier ?? "AUTO");
  // The server never returns the stored key (write-only) — this field always starts
  // blank and is only sent on save if the user actually typed into it (aiKeyTouched).
  const [draftAiApiKey, setDraftAiApiKey] = useState<string>("");
  const [aiKeyTouched, setAiKeyTouched] = useState(false);
  const [draftAccessMode, setDraftAccessMode] = useState<AiAccessMode>(activeKey?.aiAccessMode ?? "SYSTEM");
  const [draftHostAuthWebhookUrl, setDraftHostAuthWebhookUrl] = useState<string>(activeKey?.hostAuthWebhookUrl ?? "");
  // Write-only, same convention as draftAiApiKey.
  const [draftHostWebhookSecret, setDraftHostWebhookSecret] = useState<string>("");
  const [hostWebhookSecretTouched, setHostWebhookSecretTouched] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);

  useEffect(() => {
    const selected = activeKeyId ? apiKeys.find((item) => item.id === activeKeyId) : null;
    setDraftUseAi(selected?.useAi ?? false);
    setDraftAiProvider(normalizeProvider(selected?.aiProvider ?? "openai"));
    setDraftAiTier(selected?.aiTier ?? "AUTO");
    setDraftAiApiKey("");
    setAiKeyTouched(false);
    setDraftAccessMode(selected?.aiAccessMode ?? "SYSTEM");
    setDraftHostAuthWebhookUrl(selected?.hostAuthWebhookUrl ?? "");
    setDraftHostWebhookSecret("");
    setHostWebhookSecretTouched(false);
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
            ...(aiKeyTouched ? { aiApiKey: draftAiApiKey } : {}),
            aiAccessMode: draftAccessMode,
            hostAuthWebhookUrl: draftHostAuthWebhookUrl,
            ...(hostWebhookSecretTouched ? { hostWebhookSecret: draftHostWebhookSecret } : {}),
          }),
        });
        if (!response.ok) throw new Error("Unable to persist AI configuration.");
        const payload = (await response.json()) as { apiKey: SettingsApiKey };
        setApiKeys((current) => current.map((item) => (item.id === payload.apiKey.id ? payload.apiKey : item)));
        setSaveNotice("AI settings saved.");
        setDraftDirty(false);
        if (aiKeyTouched) {
          setDraftAiApiKey("");
          setAiKeyTouched(false);
        }
        if (hostWebhookSecretTouched) {
          setDraftHostWebhookSecret("");
          setHostWebhookSecretTouched(false);
        }
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Unable to persist AI configuration.");
      } finally {
        setSaving(false);
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    activeKey,
    draftAiProvider,
    draftAiTier,
    draftDirty,
    draftUseAi,
    draftAiApiKey,
    aiKeyTouched,
    draftAccessMode,
    draftHostAuthWebhookUrl,
    draftHostWebhookSecret,
    hostWebhookSecretTouched,
  ]);

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
    setRevokingKeys((prev) => {
      const next = new Set(prev);
      next.add(keyId);
      return next;
    });
    try {
      const response = await fetch(`/api/settings/api-keys/${keyId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      if (!response.ok) throw new Error("Unable to revoke API key.");
      setApiKeys((current) => {
        const nextState = current.filter((item) => item.id !== keyId);
        if (activeKeyId === keyId) {
          const nextActive = nextState.find((item) => item.isActive);
          setActiveKeyId(nextActive?.id ?? null);
        }
        return nextState;
      });
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

  async function toggleManageLandingPagePublishing(): Promise<void> {
    if (!isUltra) return;
    const next = !manageLandingPagePublishing;
    setManageLandingPagePublishing(next);
    setPublishSettingSaving(true);
    setPublishSettingError(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manageLandingPagePublishing: next }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Unable to update this setting.");
      }
    } catch (error) {
      setManageLandingPagePublishing(!next);
      setPublishSettingError(error instanceof Error ? error.message : "Unable to update this setting.");
    } finally {
      setPublishSettingSaving(false);
    }
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
            padding: "1rem 1.25rem",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            flexWrap: "wrap",
            gap: "0.75rem",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <div style={{
                width: 34, height: 34, borderRadius: 9,
                background: "var(--brand-subtle)", border: "1px solid rgba(139,92,246,0.2)",
                display: "grid", placeItems: "center", color: "var(--brand)", flexShrink: 0,
              }}>
                <IconKey />
              </div>
              <div>
                <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff" }}>
                  API Key Management
                </h2>
                <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.35)" }}>
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
                padding: "0.5rem 0.9rem",
                borderRadius: 9, border: "none", cursor: isGenerating ? "not-allowed" : "pointer",
                fontSize: "0.78rem", fontWeight: 700,
                background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
                color: "#fff", opacity: isGenerating ? 0.7 : 1,
                boxShadow: "0 3px 14px var(--brand-glow)",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
                marginLeft: "auto",
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
                    <th key={h} style={{
                      padding: "0.75rem 1rem",
                      textAlign: "left", fontWeight: 600, fontSize: "0.7rem",
                      letterSpacing: "0.08em", textTransform: "uppercase",
                      color: "rgba(240,242,255,0.35)", whiteSpace: "nowrap",
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
                          disabled={!item.isActive || revokingKeys.has(item.id)}
                          onClick={() => void revokeKey(item.id)}
                          style={{
                            padding: "0.4rem 0.85rem",
                            borderRadius: 7,
                            border: "1px solid rgba(248,113,113,0.25)",
                            background: "transparent",
                            color: "#f87171", fontSize: "0.75rem", fontWeight: 600,
                            cursor: (item.isActive && !revokingKeys.has(item.id)) ? "pointer" : "not-allowed",
                            opacity: (item.isActive && !revokingKeys.has(item.id)) ? 1 : 0.4,
                            fontFamily: "inherit",
                            transition: "background 0.15s",
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

        {/* ── LANDING PAGE PUBLISHING ─────────────── */}
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16, padding: "1.5rem",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.35rem" }}>
                Landing Page Publishing
              </h2>
              <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.35)", maxWidth: 520 }}>
                Let embedded SDK builders publish landing pages directly to your account&apos;s domain limit, with no cap on how many domains they publish.
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0 }}>
              {!isUltra && (
                <span style={{
                  fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.05em",
                  textTransform: "uppercase", color: "var(--brand)",
                  background: "var(--brand-subtle)", padding: "0.2rem 0.5rem", borderRadius: 5
                }}>
                  Requires Ultra
                </span>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={manageLandingPagePublishing}
                id="toggle-manage-landing-page-publishing"
                disabled={!isUltra || publishSettingSaving}
                onClick={() => void toggleManageLandingPagePublishing()}
                style={{
                  position: "relative",
                  width: 44, height: 24,
                  borderRadius: 999,
                  background: manageLandingPagePublishing ? "var(--brand)" : "rgba(255,255,255,0.1)",
                  border: manageLandingPagePublishing ? "1px solid var(--brand)" : "1px solid rgba(255,255,255,0.12)",
                  cursor: (isUltra && !publishSettingSaving) ? "pointer" : "not-allowed",
                  opacity: isUltra ? 1 : 0.5,
                  transition: "background 0.2s, border-color 0.2s",
                  flexShrink: 0,
                }}
              >
                <span style={{
                  position: "absolute",
                  top: 3, left: manageLandingPagePublishing ? 22 : 3,
                  width: 16, height: 16, borderRadius: "50%",
                  background: "#fff",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                  transition: "left 0.2s cubic-bezier(0.4,0,0.2,1)",
                }} />
              </button>
            </div>
          </div>

          {!isUltra && (
            <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", marginTop: "1rem" }}>
              Upgrade to Ultra in the Billing section below to unlock self-managed publishing.
            </p>
          )}
          {publishSettingError && (
            <p style={{ fontSize: "0.78rem", color: "#f87171", marginTop: "0.75rem" }}>{publishSettingError}</p>
          )}
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
                    {/* AI Access Mode */}
                    <div>
                      <p style={{ fontSize: "0.78rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.4)", marginBottom: "0.5rem" }}>
                        AI Access Mode
                      </p>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        {ACCESS_MODE_OPTIONS.map((option) => {
                          const active = draftAccessMode === option.value;
                          const requiresUltra = option.value === "HOST_MANAGED" && !isUltra;
                          const isBtnDisabled = !activeKey.isActive || requiresUltra;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              disabled={isBtnDisabled}
                              onClick={() => {
                                setDraftAccessMode(option.value);
                                setDraftDirty(true);
                                setApiKeys((current) => current.map((item) => (item.id === activeKey.id ? { ...item, aiAccessMode: option.value } : item)));
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
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <p style={{ fontSize: "0.8rem", fontWeight: active ? 700 : 600 }}>{option.label}</p>
                                {requiresUltra && (
                                  <span style={{
                                    fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.05em",
                                    textTransform: "uppercase", color: "var(--brand)",
                                    background: "var(--brand-subtle)", padding: "0.15rem 0.4rem", borderRadius: 5
                                  }}>
                                    Requires Ultra
                                  </span>
                                )}
                              </div>
                              <p style={{ fontSize: "0.68rem", color: active ? "rgba(196,181,253,0.7)" : "rgba(240,242,255,0.3)" }}>{option.desc}</p>
                            </button>
                          );
                        })}
                      </div>
                      {draftAccessMode === "HOST_MANAGED" && !isUltra && (
                        <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", marginTop: "0.5rem" }}>
                          This account is configured for Host-Managed AI access but is not on the Ultra plan — AI requests will be blocked until you upgrade. Upgrade in the Billing section below.
                        </p>
                      )}
                    </div>

                    {draftAccessMode !== "HOST_MANAGED" && (
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
                    </>
                    )}

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

                    {draftAccessMode === "BYOK" && (
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
                        placeholder={activeKey.hasAiApiKey && !aiKeyTouched ? "•••••••••••••••• (saved — enter a new key to replace it)" : "Enter your AI provider API key"}
                        value={draftAiApiKey}
                        disabled={!activeKey.isActive}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraftAiApiKey(v);
                          setAiKeyTouched(true);
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
                      <p style={{ fontSize: "0.72rem", color: activeKey.hasAiApiKey ? "#34d399" : "rgba(240,242,255,0.3)", marginTop: "0.3rem" }}>
                        {activeKey.hasAiApiKey
                          ? "A key is saved and encrypted at rest. It is never sent back to the browser — leave this field blank to keep it."
                          : "This key is encrypted at rest and used server-side only when querying the builder AI functions."}
                      </p>
                    </div>
                    )}

                    {draftAccessMode === "HOST_MANAGED" && (
                    <>
                    <div>
                      <span style={{
                        display: "block", fontSize: "0.78rem", fontWeight: 600,
                        letterSpacing: "0.06em", textTransform: "uppercase",
                        color: "rgba(240,242,255,0.4)",
                        marginBottom: "0.4rem"
                      }}>
                        Authorization Webhook URL
                      </span>
                      <input
                        type="text"
                        placeholder="https://your-app.example.com/api/v1/plexo-webhooks"
                        value={draftHostAuthWebhookUrl}
                        disabled={!activeKey.isActive}
                        onChange={(e) => {
                          setDraftHostAuthWebhookUrl(e.target.value);
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
                        Called with POST {"{url}"}/ai-authorize and /ai-charge before and after every AI action — your app decides who can afford it and charges them.
                      </p>
                    </div>
                    <div>
                      <span style={{
                        display: "block", fontSize: "0.78rem", fontWeight: 600,
                        letterSpacing: "0.06em", textTransform: "uppercase",
                        color: "rgba(240,242,255,0.4)",
                        marginBottom: "0.4rem"
                      }}>
                        Webhook Signing Secret
                      </span>
                      <input
                        type="password"
                        placeholder={activeKey.hasHostWebhookSecret && !hostWebhookSecretTouched ? "•••••••••••••••• (saved — enter a new value to replace it)" : "Shared secret used to sign/verify webhook calls"}
                        value={draftHostWebhookSecret}
                        disabled={!activeKey.isActive}
                        onChange={(e) => {
                          setDraftHostWebhookSecret(e.target.value);
                          setHostWebhookSecretTouched(true);
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
                      <p style={{ fontSize: "0.72rem", color: activeKey.hasHostWebhookSecret ? "#34d399" : "rgba(240,242,255,0.3)", marginTop: "0.3rem" }}>
                        {activeKey.hasHostWebhookSecret
                          ? "A secret is saved and encrypted at rest. It is never sent back to the browser — leave this field blank to keep it."
                          : "Must match the secret your webhook uses to verify the x-plexo-signature header."}
                      </p>
                    </div>
                    <a
                      href="/dashboard/integrations"
                      style={{ fontSize: "0.75rem", color: "var(--brand)", textDecoration: "underline", display: "inline-block" }}
                    >
                      View the full webhook integration guide (payload shapes, signature verification, endpoints to implement) →
                    </a>
                    </>
                    )}
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

        {/* ── BILLING & CREDITS ──────────────────── */}
        <BillingSection
          plan={billing.plan}
          allowanceBalance={billing.allowanceBalance}
          topupBalance={billing.topupBalance}
          allowanceResetAt={billing.allowanceResetAt}
          recentActivity={billing.recentActivity}
        />
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
