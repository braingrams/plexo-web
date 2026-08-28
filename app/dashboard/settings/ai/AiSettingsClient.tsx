"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../_components/PageHeader";
import { CustomSelect } from "../../../_components/CustomSelect";
import type { AiTier, AiAccessMode, AiSettingsApiKey } from "./page";

type Provider = "openai" | "anthropic_claude" | "google_gemini";

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

const ACCESS_MODE_OPTIONS: Array<{ value: AiAccessMode; label: string; desc: string }> = [
  { value: "SYSTEM", label: "System AI", desc: "Plexo's own credit balance pays" },
  { value: "BYOK", label: "Bring Your Own Key", desc: "Your own provider key pays, no credits used" },
  { value: "HOST_MANAGED", label: "Host-Managed", desc: "Your app authorizes & bills its own users" },
];

function normalizeProvider(value: string): Provider {
  if (value === "anthropic_claude" || value.toLowerCase().includes("claude")) return "anthropic_claude";
  if (value === "google_gemini" || value.toLowerCase().includes("gemini")) return "google_gemini";
  return "openai";
}

function IconArrowRight() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export function AiSettingsClient({ initialApiKeys, isUltra }: { initialApiKeys: AiSettingsApiKey[]; isUltra: boolean }) {
  const [apiKeys, setApiKeys] = useState<AiSettingsApiKey[]>(initialApiKeys);
  const [activeKeyId, setActiveKeyId] = useState<string | null>(
    initialApiKeys.find((item) => item.isActive)?.id ?? initialApiKeys[0]?.id ?? null,
  );
  const activeKey = useMemo(() => apiKeys.find((item) => item.id === activeKeyId) ?? null, [apiKeys, activeKeyId]);

  const [draftUseAi, setDraftUseAi] = useState<boolean>(activeKey?.useAi ?? false);
  const [draftAiProvider, setDraftAiProvider] = useState<Provider>(normalizeProvider(activeKey?.aiProvider ?? "openai"));
  const [draftAiTier, setDraftAiTier] = useState<AiTier>(activeKey?.aiTier ?? "AUTO");
  // The server never returns the stored key (write-only) — this field always starts blank
  // and is only sent on save if the user actually typed into it (aiKeyTouched).
  const [draftAiApiKey, setDraftAiApiKey] = useState<string>("");
  const [aiKeyTouched, setAiKeyTouched] = useState(false);
  const [providerTouched, setProviderTouched] = useState(false);
  const [draftAccessMode, setDraftAccessMode] = useState<AiAccessMode>(activeKey?.aiAccessMode ?? "SYSTEM");
  const [draftHostAuthWebhookUrl, setDraftHostAuthWebhookUrl] = useState<string>(activeKey?.hostAuthWebhookUrl ?? "");
  const [draftHostWebhookSecret, setDraftHostWebhookSecret] = useState<string>("");
  const [hostWebhookSecretTouched, setHostWebhookSecretTouched] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    const selected = activeKeyId ? apiKeys.find((item) => item.id === activeKeyId) : null;
    setDraftUseAi(selected?.useAi ?? false);
    setDraftAiProvider(normalizeProvider(selected?.aiProvider ?? "openai"));
    setDraftAiTier(selected?.aiTier ?? "AUTO");
    setDraftAiApiKey("");
    setAiKeyTouched(false);
    setProviderTouched(false);
    setDraftAccessMode(selected?.aiAccessMode ?? "SYSTEM");
    setDraftHostAuthWebhookUrl(selected?.hostAuthWebhookUrl ?? "");
    setDraftHostWebhookSecret("");
    setHostWebhookSecretTouched(false);
    setDraftDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKeyId]);

  useEffect(() => {
    if (!draftDirty || !activeKey) return;
    if (draftAccessMode === "HOST_MANAGED" && aiKeyTouched && !providerTouched) {
      setSaveError("Confirm the AI Provider that matches the key you just entered, then save again — Plexo routes every request using this selection.");
      return;
    }
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
        if (!response.ok) {
          const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(errorPayload?.error ?? "Unable to persist AI configuration.");
        }
        const payload = (await response.json()) as { apiKey: AiSettingsApiKey };
        setApiKeys((current) => current.map((item) => (item.id === payload.apiKey.id ? payload.apiKey : item)));
        setSaveNotice("AI settings saved.");
        setDraftDirty(false);
        if (aiKeyTouched) {
          setDraftAiApiKey("");
          setAiKeyTouched(false);
          setProviderTouched(false);
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
    activeKey, draftAiProvider, draftAiTier, draftDirty, draftUseAi, draftAiApiKey,
    aiKeyTouched, providerTouched, draftAccessMode, draftHostAuthWebhookUrl, draftHostWebhookSecret, hostWebhookSecretTouched,
  ]);

  const keyOptions = apiKeys.map((k) => ({ label: `${k.name}${k.isActive ? "" : " (revoked)"}`, value: k.id, disabled: !k.isActive }));

  return (
    <>
      <PageHeader eyebrow="Developer" title="AI" subtitle="Configure the AI proxy for each of your API keys." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.5rem" }}>
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "1.5rem" }}>
          <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.35rem" }}>
            AI Configuration
          </h2>
          <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.35)", marginBottom: "1.25rem" }}>
            Changes auto-save for the selected API key.
          </p>

          {apiKeys.length === 0 ? (
            <div style={{ padding: "1.25rem", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.1)", textAlign: "center", color: "rgba(240,242,255,0.35)", fontSize: "0.875rem" }}>
              You don&apos;t have any API keys yet — generate one on the API Keys page first.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
              <div>
                <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.4)", marginBottom: "0.4rem" }}>
                  API Key
                </span>
                <CustomSelect value={activeKeyId ?? ""} options={keyOptions} onChange={(v) => setActiveKeyId(v)} />
              </div>

              {activeKey && (
                <>
                  {/* Use AI Toggle */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.9rem 1rem", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 11 }}>
                    <div>
                      <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "#f0f2ff" }}>Use AI</p>
                      <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.35)" }}>Enable AI proxy for this token</p>
                    </div>
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
                        position: "relative", width: 44, height: 24, borderRadius: 999,
                        background: draftUseAi ? "var(--brand)" : "rgba(255,255,255,0.1)",
                        border: draftUseAi ? "1px solid var(--brand)" : "1px solid rgba(255,255,255,0.12)",
                        cursor: activeKey.isActive ? "pointer" : "not-allowed",
                        opacity: activeKey.isActive ? 1 : 0.5,
                        transition: "background 0.2s, border-color 0.2s", flexShrink: 0,
                      }}
                    >
                      <span style={{ position: "absolute", top: 3, left: draftUseAi ? 22 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", transition: "left 0.2s cubic-bezier(0.4,0,0.2,1)" }} />
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
                                  padding: "0.65rem 0.75rem", borderRadius: 9,
                                  border: active ? "1.5px solid rgba(139,92,246,0.4)" : "1px solid rgba(255,255,255,0.08)",
                                  background: active ? "rgba(139,92,246,0.1)" : "rgba(255,255,255,0.03)",
                                  color: active ? "#c4b5fd" : "rgba(240,242,255,0.55)",
                                  cursor: isBtnDisabled ? "not-allowed" : "pointer",
                                  fontFamily: "inherit", textAlign: "left", transition: "all 0.15s",
                                  opacity: isBtnDisabled && !active ? 0.5 : 1,
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                  <p style={{ fontSize: "0.8rem", fontWeight: active ? 700 : 600 }}>{option.label}</p>
                                  {requiresUltra && (
                                    <span style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--brand)", background: "var(--brand-subtle)", padding: "0.15rem 0.4rem", borderRadius: 5 }}>
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
                            This account is configured for Host-Managed AI access but is not on the Ultra plan — AI requests will be blocked until you upgrade. Upgrade in the Subscription section.
                          </p>
                        )}
                      </div>

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
                            setProviderTouched(true);
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
                                  padding: "0.65rem 0.75rem", borderRadius: 9,
                                  border: active ? "1.5px solid rgba(139,92,246,0.4)" : "1px solid rgba(255,255,255,0.08)",
                                  background: active ? "rgba(139,92,246,0.1)" : "rgba(255,255,255,0.03)",
                                  color: active ? "#c4b5fd" : "rgba(240,242,255,0.55)",
                                  cursor: isBtnDisabled ? "not-allowed" : "pointer",
                                  fontFamily: "inherit", textAlign: "left", transition: "all 0.15s",
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

                      {(draftAccessMode === "BYOK" || draftAccessMode === "HOST_MANAGED") && (
                        <div>
                          <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.4)", marginBottom: "0.4rem" }}>
                            AI API Key
                          </span>
                          <input
                            type="password"
                            placeholder={activeKey.hasAiApiKey && !aiKeyTouched ? "•••••••••••••••• (saved — enter a new key to replace it)" : "Enter your AI provider API key"}
                            value={draftAiApiKey}
                            disabled={!activeKey.isActive}
                            onChange={(e) => {
                              setDraftAiApiKey(e.target.value);
                              setAiKeyTouched(true);
                              setDraftDirty(true);
                            }}
                            style={{ width: "100%", padding: "0.6rem 0.875rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "rgba(240,242,255,0.9)", fontFamily: "inherit", fontSize: "0.875rem", outline: "none", cursor: "text", transition: "border-color 0.15s" }}
                          />
                          <p style={{ fontSize: "0.72rem", color: activeKey.hasAiApiKey ? "#34d399" : "rgba(240,242,255,0.3)", marginTop: "0.3rem" }}>
                            {activeKey.hasAiApiKey
                              ? "A key is saved and encrypted at rest. It is never sent back to the browser — leave this field blank to keep it."
                              : draftAccessMode === "HOST_MANAGED"
                                ? "Required for Host-Managed access — Plexo's system key is never used in this mode. Encrypted at rest, used server-side only."
                                : "This key is encrypted at rest and used server-side only when querying the builder AI functions."}
                          </p>
                        </div>
                      )}

                      {draftAccessMode === "HOST_MANAGED" && (
                        <>
                          <div>
                            <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.4)", marginBottom: "0.4rem" }}>
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
                              style={{ width: "100%", padding: "0.6rem 0.875rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "rgba(240,242,255,0.9)", fontFamily: "inherit", fontSize: "0.875rem", outline: "none", cursor: "text", transition: "border-color 0.15s" }}
                            />
                            <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.3)", marginTop: "0.3rem" }}>
                              Called with POST {"{url}"}/ai-authorize and /ai-charge before and after every AI action — your app decides who can afford it and charges them.
                            </p>
                          </div>
                          <div>
                            <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.4)", marginBottom: "0.4rem" }}>
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
                              style={{ width: "100%", padding: "0.6rem 0.875rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "rgba(240,242,255,0.9)", fontFamily: "inherit", fontSize: "0.875rem", outline: "none", cursor: "text", transition: "border-color 0.15s" }}
                            />
                            <p style={{ fontSize: "0.72rem", color: activeKey.hasHostWebhookSecret ? "#34d399" : "rgba(240,242,255,0.3)", marginTop: "0.3rem" }}>
                              {activeKey.hasHostWebhookSecret
                                ? "A secret is saved and encrypted at rest. It is never sent back to the browser — leave this field blank to keep it."
                                : "Must match the secret your webhook uses to verify the x-plexo-signature header."}
                            </p>
                          </div>
                          <a href="/dashboard/integrations" style={{ fontSize: "0.75rem", color: "var(--brand)", textDecoration: "underline", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                            View the full webhook integration guide (payload shapes, signature verification, endpoints to implement) <IconArrowRight />
                          </a>
                        </>
                      )}
                    </>
                  )}

                  {saving && <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.45)" }}>Saving…</p>}
                  {saveNotice && <p style={{ fontSize: "0.78rem", color: "#34d399" }}>{saveNotice}</p>}
                  {saveError && <p style={{ fontSize: "0.78rem", color: "#f87171" }}>{saveError}</p>}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
