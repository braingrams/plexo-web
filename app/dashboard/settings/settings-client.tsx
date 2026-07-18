"use client";

import { useEffect, useMemo, useState } from "react";

type AiTier = "AUTO" | "BASIC" | "MEDIUM" | "HIGH";
type Provider = "openai" | "anthropic_claude" | "google_gemini";
type SettingsApiKey = {
  id: string;
  name: string;
  maskedKey: string;
  createdAt: string;
  isActive: boolean;
  useAi: boolean;
  aiModel: string;
  aiTier: AiTier;
};

type Props = {
  initialApiKeys: SettingsApiKey[];
};

const PROVIDER_OPTIONS: Array<{ label: string; value: Provider }> = [
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic/Claude", value: "anthropic_claude" },
  { label: "Google Gemini", value: "google_gemini" },
];

const TIER_OPTIONS: Array<{ label: string; value: AiTier }> = [
  { label: "Base (Strict/Deterministic)", value: "BASIC" },
  { label: "Medium (Balanced)", value: "MEDIUM" },
  { label: "High (Creative)", value: "HIGH" },
  { label: "Auto (System Default)", value: "AUTO" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function normalizeProvider(value: string): Provider {
  if (value === "anthropic_claude" || value.toLowerCase().includes("claude")) {
    return "anthropic_claude";
  }
  if (value === "google_gemini" || value.toLowerCase().includes("gemini")) {
    return "google_gemini";
  }
  return "openai";
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
  const [draftAiModel, setDraftAiModel] = useState<Provider>(
    normalizeProvider(activeKey?.aiModel ?? "openai"),
  );
  const [draftAiTier, setDraftAiTier] = useState<AiTier>(activeKey?.aiTier ?? "AUTO");
  const [draftDirty, setDraftDirty] = useState(false);

  useEffect(() => {
    if (!activeKeyId) {
      setDraftUseAi(false);
      setDraftAiModel("openai");
      setDraftAiTier("AUTO");
      setDraftDirty(false);
      return;
    }

    const selected = apiKeys.find((item) => item.id === activeKeyId);
    if (!selected) {
      setDraftUseAi(false);
      setDraftAiModel("openai");
      setDraftAiTier("AUTO");
      setDraftDirty(false);
      return;
    }

    setDraftUseAi(selected.useAi);
    setDraftAiModel(normalizeProvider(selected.aiModel));
    setDraftAiTier(selected.aiTier);
    setDraftDirty(false);
  }, [activeKeyId]);

  useEffect(() => {
    if (!draftDirty || !activeKey) {
      return;
    }

    const timer = window.setTimeout(async () => {
      setSaving(true);
      setSaveError(null);
      setSaveNotice(null);

      try {
        const response = await fetch(`/api/settings/api-keys/${activeKey.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            useAi: draftUseAi,
            aiModel: draftAiModel,
            aiTier: draftAiTier,
          }),
        });

        if (!response.ok) {
          throw new Error("Unable to persist AI configuration.");
        }

        const payload = (await response.json()) as { apiKey: SettingsApiKey };

        setApiKeys((current) =>
          current.map((item) => (item.id === payload.apiKey.id ? payload.apiKey : item)),
        );
        setSaveNotice("AI settings saved.");
        setDraftDirty(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to persist AI configuration.";
        setSaveError(message);
      } finally {
        setSaving(false);
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, [activeKey, draftAiModel, draftAiTier, draftDirty, draftUseAi]);

  async function generateApiKey(): Promise<void> {
    setIsGenerating(true);
    setSaveError(null);

    try {
      const response = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error("Unable to generate a new API key.");
      }

      const payload = (await response.json()) as {
        apiKey: SettingsApiKey;
        rawKey: string;
      };

      setApiKeys((current) => [payload.apiKey, ...current]);
      setActiveKeyId(payload.apiKey.id);
      setGeneratedRawKey(payload.rawKey);
      setCopied(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to generate a new API key.";
      setSaveError(message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function revokeKey(keyId: string): Promise<void> {
    setSaveError(null);

    try {
      const response = await fetch(`/api/settings/api-keys/${keyId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "revoke" }),
      });

      if (!response.ok) {
        throw new Error("Unable to revoke API key.");
      }

      const payload = (await response.json()) as { apiKey: SettingsApiKey };

      setApiKeys((current) => {
        const nextState = current.map((item) =>
          item.id === payload.apiKey.id ? payload.apiKey : item,
        );

        if (activeKeyId === payload.apiKey.id && !payload.apiKey.isActive) {
          const nextActive = nextState.find((item) => item.id !== payload.apiKey.id && item.isActive);
          setActiveKeyId(nextActive?.id ?? null);
        }

        return nextState;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to revoke API key.";
      setSaveError(message);
    }
  }

  async function copyRawKey(): Promise<void> {
    if (!generatedRawKey) {
      return;
    }
    await navigator.clipboard.writeText(generatedRawKey);
    setCopied(true);
  }

  function closeModal(): void {
    setGeneratedRawKey(null);
    setCopied(false);
  }

  function formatDate(iso: string): string {
    const date = new Date(iso);
    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = MONTHS[date.getUTCMonth()];
    const year = date.getUTCFullYear();
    return `${day} ${month} ${year}`;
  }

  return (
    <section className="w-full max-w-6xl rounded-3xl border border-sky-200/20 bg-[#081324]/70 p-4 shadow-[0_32px_120px_rgba(0,0,0,.45)] backdrop-blur md:p-7">
      <header className="mb-6 flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/90">Plexo Control</p>
        <h1 className="font-[var(--font-heading)] text-2xl text-sky-50 md:text-3xl">Developer Settings</h1>
        <p className="text-sm text-sky-100/70">Manage API credentials and global AI proxy behavior for your active token.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-5">
        <article className="rounded-2xl border border-sky-200/20 bg-[#0a1a30]/80 p-4 md:col-span-3">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-[var(--font-heading)] text-lg text-sky-50">API Key Management</h2>
            <button
              type="button"
              onClick={generateApiKey}
              disabled={isGenerating}
              className="rounded-xl bg-gradient-to-r from-sky-300 to-cyan-400 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:brightness-110 disabled:opacity-60"
            >
              {isGenerating ? "Generating..." : "Generate New API Key"}
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-sky-200/15">
            <table className="min-w-full text-sm">
              <thead className="bg-sky-900/40 text-left text-xs uppercase tracking-[0.12em] text-sky-200/90">
                <tr>
                  <th className="px-3 py-3">Name</th>
                  <th className="px-3 py-3">Masked Key</th>
                  <th className="px-3 py-3">Created Date</th>
                  <th className="px-3 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-sky-200/70">
                      No API keys yet. Generate your first key to activate AI settings.
                    </td>
                  </tr>
                ) : (
                  apiKeys.map((item) => (
                    <tr
                      key={item.id}
                      className={`border-t border-sky-200/10 ${activeKeyId === item.id ? "bg-sky-900/25" : "bg-transparent"}`}
                    >
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => setActiveKeyId(item.id)}
                          className="text-left text-sky-50 hover:text-white"
                        >
                          {item.name}
                          {!item.isActive ? <span className="ml-2 text-xs text-rose-300">Revoked</span> : null}
                        </button>
                      </td>
                      <td className="px-3 py-3 font-mono text-sky-100/85">{item.maskedKey}</td>
                      <td className="px-3 py-3 text-sky-100/85">{formatDate(item.createdAt)}</td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          disabled={!item.isActive}
                          onClick={() => void revokeKey(item.id)}
                          className="rounded-lg border border-rose-300/45 px-2.5 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-400/15 disabled:cursor-not-allowed disabled:opacity-45"
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
        </article>

        <article className="rounded-2xl border border-sky-200/20 bg-[#0a1a30]/80 p-4 md:col-span-2">
          <h2 className="mb-1 font-[var(--font-heading)] text-lg text-sky-50">Global AI Configuration</h2>
          <p className="mb-4 text-xs text-sky-100/65">Changes auto-save in the background for the selected API key.</p>

          {!activeKey ? (
            <p className="rounded-xl border border-sky-200/15 bg-sky-900/30 p-3 text-sm text-sky-100/75">
              Select or generate an active API key to configure AI preferences.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-sky-200/20 bg-sky-900/20 p-3">
                <div>
                  <p className="text-sm font-semibold text-sky-50">Use AI</p>
                  <p className="text-xs text-sky-100/65">Enable AI proxy routing for this token.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draftUseAi}
                  disabled={!activeKey.isActive}
                  onClick={() => {
                    const next = !draftUseAi;
                    setDraftUseAi(next);
                    setDraftDirty(true);
                    setApiKeys((current) =>
                      current.map((item) => (item.id === activeKey.id ? { ...item, useAi: next } : item)),
                    );
                  }}
                  className={`relative h-7 w-12 rounded-full transition ${draftUseAi ? "bg-cyan-400" : "bg-slate-700"} ${!activeKey.isActive ? "opacity-50" : ""}`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${draftUseAi ? "left-6" : "left-1"}`}
                  />
                </button>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-sky-200/90">Preferred AI Provider</span>
                <select
                  value={draftAiModel}
                  disabled={!activeKey.isActive}
                  onChange={(event) => {
                    const next = event.target.value as Provider;
                    setDraftAiModel(next);
                    setDraftDirty(true);
                    setApiKeys((current) =>
                      current.map((item) => (item.id === activeKey.id ? { ...item, aiModel: next } : item)),
                    );
                  }}
                  className="w-full rounded-xl border border-sky-200/30 bg-[#06152a] px-3 py-2 text-sm text-sky-50 outline-none focus:border-sky-300"
                >
                  {PROVIDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-sky-200/90">AI Creativity Tier</span>
                <select
                  value={draftAiTier}
                  disabled={!activeKey.isActive}
                  onChange={(event) => {
                    const next = event.target.value as AiTier;
                    setDraftAiTier(next);
                    setDraftDirty(true);
                    setApiKeys((current) =>
                      current.map((item) => (item.id === activeKey.id ? { ...item, aiTier: next } : item)),
                    );
                  }}
                  className="w-full rounded-xl border border-sky-200/30 bg-[#06152a] px-3 py-2 text-sm text-sky-50 outline-none focus:border-sky-300"
                >
                  {TIER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {saving ? <p className="text-xs text-sky-300">Saving...</p> : null}
              {saveNotice ? <p className="text-xs text-emerald-300">{saveNotice}</p> : null}
              {saveError ? <p className="text-xs text-rose-300">{saveError}</p> : null}
            </div>
          )}
        </article>
      </div>

      {generatedRawKey ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#02060fcc] p-4">
          <div className="w-full max-w-lg rounded-2xl border border-cyan-200/25 bg-[#061122] p-5 shadow-2xl">
            <h3 className="font-[var(--font-heading)] text-xl text-sky-50">Secure API Key Reveal</h3>
            <p className="mt-2 text-sm text-sky-100/75">
              This is the only time the full key will be shown. Copy and store it securely now.
            </p>

            <div className="mt-4 rounded-xl border border-cyan-300/30 bg-sky-950/70 px-3 py-3 font-mono text-sm text-cyan-200">
              {generatedRawKey}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyRawKey()}
                className="rounded-xl bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-900"
              >
                {copied ? "Copied" : "Copy to Clipboard"}
              </button>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-xl border border-sky-200/35 px-3 py-2 text-sm font-semibold text-sky-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
