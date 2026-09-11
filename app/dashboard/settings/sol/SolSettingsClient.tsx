"use client";

import { useEffect, useState } from "react";

import { PageHeader } from "../../_components/PageHeader";
import { Card } from "../../_components/Card";
import { Toggle } from "../../_components/Toggle";
import { CustomSelect } from "../../../_components/CustomSelect";
import type {
  SolPreferencesData,
  SolMemoryItem,
  SolTonePreset,
  SolModelTier,
  SolResponseLength,
  SolMemorySource,
} from "./page";

const SECTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: "0.78rem",
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "rgba(240,242,255,0.4)",
  marginBottom: "0.5rem",
};

const CHIP_BASE: React.CSSProperties = {
  padding: "0.65rem 0.75rem",
  borderRadius: 9,
  fontFamily: "inherit",
  textAlign: "left",
  transition: "all 0.15s",
  cursor: "pointer",
};

function chipStyle(active: boolean): React.CSSProperties {
  return {
    ...CHIP_BASE,
    border: active ? "1.5px solid rgba(139,92,246,0.4)" : "1px solid rgba(255,255,255,0.08)",
    background: active ? "rgba(139,92,246,0.1)" : "rgba(255,255,255,0.03)",
    color: active ? "#c4b5fd" : "rgba(240,242,255,0.55)",
  };
}

const TONE_OPTIONS: Array<{ value: SolTonePreset; label: string; desc: string }> = [
  { value: "PROFESSIONAL", label: "Professional", desc: "Polished, businesslike phrasing" },
  { value: "FRIENDLY", label: "Friendly", desc: "Warm and conversational" },
  { value: "CONCISE", label: "Concise", desc: "Short and to the point" },
  { value: "DETAILED", label: "Detailed", desc: "Thorough, spelled-out explanations" },
];

const MODEL_TIER_OPTIONS: Array<{ value: SolModelTier; label: string }> = [
  { value: "BASIC", label: "Standard (fast, great for everyday tasks)" },
  { value: "MEDIUM", label: "Advanced (stronger reasoning, still quick)" },
  { value: "HIGH", label: "Most Capable (slower, best for complex work)" },
];

const RESPONSE_LENGTH_OPTIONS: Array<{ value: SolResponseLength; label: string; desc: string }> = [
  { value: "CONCISE", label: "Concise", desc: "Short, direct answers" },
  { value: "BALANCED", label: "Balanced", desc: "A reasonable amount of detail" },
  { value: "THOROUGH", label: "Thorough", desc: "Comprehensive, step-by-step" },
];

const CATEGORY_LABELS: Record<string, string> = {
  PREFERENCE: "Preference",
  FACT: "Fact",
  TONE: "Tone",
};

function SourceBadge({ source }: { source: SolMemorySource }) {
  const isUser = source === "USER_ADDED";
  return (
    <span
      style={{
        fontSize: "0.62rem",
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        padding: "0.15rem 0.4rem",
        borderRadius: 5,
        flexShrink: 0,
        color: isUser ? "var(--brand)" : "rgba(240,242,255,0.5)",
        background: isUser ? "var(--brand-subtle)" : "rgba(255,255,255,0.06)",
      }}
    >
      {isUser ? "Added by you" : "Learned by Sol"}
    </span>
  );
}

function SaveStatus({ saving, notice, error }: { saving: boolean; notice: string | null; error: string | null }) {
  if (saving) return <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.45)", marginTop: "0.9rem" }}>Saving…</p>;
  if (error) return <p style={{ fontSize: "0.78rem", color: "#f87171", marginTop: "0.9rem" }}>{error}</p>;
  if (notice) return <p style={{ fontSize: "0.78rem", color: "#34d399", marginTop: "0.9rem" }}>{notice}</p>;
  return null;
}

export function SolSettingsClient({
  initialPreferences,
  initialMemories,
}: {
  initialPreferences: SolPreferencesData;
  initialMemories: SolMemoryItem[];
}) {
  // ── Preferences (tone, custom instructions, model tier, memory toggle, response length) ──
  // Auto-saves on a short debounce, same pattern as AiSettingsClient.tsx's own draft/dirty/
  // debounced-PATCH flow, so every field here shares one save-status indicator below.
  const [tonePreset, setTonePreset] = useState<SolTonePreset | null>(initialPreferences.tonePreset);
  const [customInstructions, setCustomInstructions] = useState(initialPreferences.customInstructions);
  const [defaultModelTier, setDefaultModelTier] = useState<SolModelTier>(initialPreferences.defaultModelTier);
  const [memoryEnabled, setMemoryEnabled] = useState(initialPreferences.memoryEnabled);
  const [responseLength, setResponseLength] = useState<SolResponseLength>(initialPreferences.responseLength);

  const [prefsDirty, setPrefsDirty] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [prefsNotice, setPrefsNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!prefsDirty) return;
    const timer = window.setTimeout(async () => {
      setSavingPrefs(true);
      setPrefsError(null);
      setPrefsNotice(null);
      try {
        const response = await fetch("/api/v1/sol/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tonePreset,
            customInstructions,
            defaultModelTier,
            memoryEnabled,
            responseLength,
          }),
        });
        if (!response.ok) {
          const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(errorPayload?.error ?? "Unable to save SOL preferences.");
        }
        setPrefsNotice("Saved.");
        setPrefsDirty(false);
      } catch (error) {
        setPrefsError(error instanceof Error ? error.message : "Unable to save SOL preferences.");
      } finally {
        setSavingPrefs(false);
      }
    }, 450);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsDirty, tonePreset, customInstructions, defaultModelTier, memoryEnabled, responseLength]);

  // ── Memory facts ──
  const [memories, setMemories] = useState<SolMemoryItem[]>(initialMemories);
  const [memoriesError, setMemoriesError] = useState<string | null>(null);
  const [newMemoryText, setNewMemoryText] = useState("");
  const [addingMemory, setAddingMemory] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [clearingAll, setClearingAll] = useState(false);

  async function handleAddMemory() {
    const text = newMemoryText.trim();
    if (!text || addingMemory) return;
    setAddingMemory(true);
    setMemoriesError(null);
    try {
      const response = await fetch("/api/v1/sol/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, category: "PREFERENCE" }),
      });
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorPayload?.error ?? "Unable to add that memory.");
      }
      const payload = (await response.json()) as { memory: SolMemoryItem };
      setMemories((current) => [payload.memory, ...current]);
      setNewMemoryText("");
    } catch (error) {
      setMemoriesError(error instanceof Error ? error.message : "Unable to add that memory.");
    } finally {
      setAddingMemory(false);
    }
  }

  async function handleDeleteMemory(id: string) {
    const removed = memories.find((m) => m.id === id) ?? null;
    setDeletingIds((current) => new Set(current).add(id));
    setMemories((current) => current.filter((m) => m.id !== id));
    setMemoriesError(null);
    try {
      const response = await fetch(`/api/v1/sol/memories/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorPayload?.error ?? "Unable to delete that memory.");
      }
    } catch (error) {
      // Restore on failure — the optimistic removal above turned out to be wrong.
      if (removed) setMemories((current) => [...current, removed].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")));
      setMemoriesError(error instanceof Error ? error.message : "Unable to delete that memory.");
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  async function handleClearAll() {
    if (memories.length === 0 || clearingAll) return;
    if (!window.confirm(`Delete all ${memories.length} memor${memories.length === 1 ? "y" : "ies"} Sol has stored about you? This can't be undone.`)) return;
    setClearingAll(true);
    setMemoriesError(null);
    const targets = memories;
    const results = await Promise.allSettled(
      targets.map((m) => fetch(`/api/v1/sol/memories/${m.id}`, { method: "DELETE" })),
    );
    const failedIds = new Set(
      targets.filter((_, i) => {
        const result = results[i];
        return result.status === "rejected" || !result.value.ok;
      }).map((m) => m.id),
    );
    setMemories((current) => current.filter((m) => failedIds.has(m.id)));
    if (failedIds.size > 0) {
      setMemoriesError(`${failedIds.size} memor${failedIds.size === 1 ? "y" : "ies"} couldn't be deleted — try again.`);
    }
    setClearingAll(false);
  }

  return (
    <>
      <PageHeader
        eyebrow="Sol"
        title="Sol Agent"
        subtitle="Tune how Sol talks to you, which model it uses by default, and what it's allowed to remember."
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {/* Tone & style */}
        <Card>
          <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.35rem" }}>
            Tone &amp; style
          </h2>
          <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.35)", marginBottom: "1.25rem" }}>
            Pick a baseline tone, then layer on custom instructions — both apply together, the same way custom
            instructions work in other AI assistants.
          </p>

          <div style={SECTION_LABEL_STYLE}>Tone preset</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem", marginBottom: "1.25rem" }}>
            {TONE_OPTIONS.map((option) => {
              const active = tonePreset === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setTonePreset(active ? null : option.value);
                    setPrefsDirty(true);
                  }}
                  style={chipStyle(active)}
                >
                  <p style={{ fontSize: "0.8rem", fontWeight: active ? 700 : 600 }}>{option.label}</p>
                  <p style={{ fontSize: "0.68rem", color: active ? "rgba(196,181,253,0.7)" : "rgba(240,242,255,0.3)" }}>{option.desc}</p>
                </button>
              );
            })}
          </div>

          <div style={SECTION_LABEL_STYLE}>Custom instructions</div>
          <textarea
            value={customInstructions}
            maxLength={2000}
            rows={4}
            placeholder="e.g. Always show code before explaining it. Avoid emoji. Prefer metric units."
            onChange={(e) => {
              setCustomInstructions(e.target.value);
              setPrefsDirty(true);
            }}
            style={{
              width: "100%",
              padding: "0.75rem 0.875rem",
              borderRadius: 9,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.05)",
              color: "rgba(240,242,255,0.9)",
              fontFamily: "inherit",
              fontSize: "0.875rem",
              outline: "none",
              resize: "vertical",
              lineHeight: 1.5,
            }}
          />
          <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.3)", marginTop: "0.35rem", textAlign: "right" }}>
            {customInstructions.length} / 2000
          </p>
        </Card>

        {/* Model */}
        <Card>
          <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.35rem" }}>
            Model
          </h2>
          <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.35)", marginBottom: "1.25rem" }}>
            The default model tier Sol uses for new conversations. You can still switch tiers per-conversation from
            the chat itself.
          </p>
          <CustomSelect
            value={defaultModelTier}
            options={MODEL_TIER_OPTIONS}
            onChange={(v) => {
              setDefaultModelTier(v as SolModelTier);
              setPrefsDirty(true);
            }}
          />
        </Card>

        {/* Response length */}
        <Card>
          <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.35rem" }}>
            Response length
          </h2>
          <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.35)", marginBottom: "1.25rem" }}>
            How much detail Sol includes in its answers by default.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem" }}>
            {RESPONSE_LENGTH_OPTIONS.map((option) => {
              const active = responseLength === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setResponseLength(option.value);
                    setPrefsDirty(true);
                  }}
                  style={chipStyle(active)}
                >
                  <p style={{ fontSize: "0.8rem", fontWeight: active ? 700 : 600 }}>{option.label}</p>
                  <p style={{ fontSize: "0.68rem", color: active ? "rgba(196,181,253,0.7)" : "rgba(240,242,255,0.3)" }}>{option.desc}</p>
                </button>
              );
            })}
          </div>

          <SaveStatus saving={savingPrefs} notice={prefsNotice} error={prefsError} />
        </Card>

        {/* Memory */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.35rem" }}>
            <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700, color: "#f0f2ff" }}>
              Memory
            </h2>
            <Toggle
              checked={memoryEnabled}
              onChange={(next) => {
                setMemoryEnabled(next);
                setPrefsDirty(true);
              }}
              label="Let Sol remember things about you across conversations"
            />
          </div>
          <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.35)", marginBottom: memoryEnabled ? "1.25rem" : 0 }}>
            Let Sol remember things about you across conversations — preferences, recurring facts, and tone cues it
            picks up on, plus anything you add below.
          </p>

          {memoryEnabled && (
            <>
              {memories.length === 0 ? (
                <div
                  style={{
                    padding: "1.1rem",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px dashed rgba(255,255,255,0.1)",
                    textAlign: "center",
                    color: "rgba(240,242,255,0.35)",
                    fontSize: "0.82rem",
                    marginBottom: "1.1rem",
                  }}
                >
                  Sol hasn&apos;t remembered anything about you yet.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.1rem" }}>
                  {memories.map((memory) => (
                    <div
                      key={memory.id}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: "0.75rem",
                        padding: "0.7rem 0.85rem",
                        borderRadius: 9,
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        opacity: deletingIds.has(memory.id) ? 0.5 : 1,
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginBottom: "0.25rem", flexWrap: "wrap" }}>
                          <SourceBadge source={memory.source} />
                          <span style={{ fontSize: "0.66rem", color: "rgba(240,242,255,0.3)" }}>{CATEGORY_LABELS[memory.category] ?? memory.category}</span>
                        </div>
                        <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.85)", lineHeight: 1.45, wordBreak: "break-word" }}>{memory.text}</p>
                      </div>
                      <button
                        type="button"
                        aria-label="Delete memory"
                        disabled={deletingIds.has(memory.id)}
                        onClick={() => void handleDeleteMemory(memory.id)}
                        style={{
                          flexShrink: 0,
                          width: 24,
                          height: 24,
                          display: "grid",
                          placeItems: "center",
                          background: "none",
                          border: "none",
                          color: "#f87171",
                          fontSize: "1rem",
                          lineHeight: 1,
                          cursor: deletingIds.has(memory.id) ? "not-allowed" : "pointer",
                          borderRadius: 6,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                <input
                  type="text"
                  value={newMemoryText}
                  maxLength={500}
                  placeholder="Sol should always remember: …"
                  onChange={(e) => setNewMemoryText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleAddMemory();
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "0.6rem 0.875rem",
                    borderRadius: 9,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.05)",
                    color: "rgba(240,242,255,0.9)",
                    fontFamily: "inherit",
                    fontSize: "0.875rem",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  disabled={!newMemoryText.trim() || addingMemory}
                  onClick={() => void handleAddMemory()}
                  style={{
                    flexShrink: 0,
                    padding: "0.6rem 1rem",
                    borderRadius: 9,
                    border: "none",
                    background: "var(--brand)",
                    color: "#fff",
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    fontFamily: "inherit",
                    cursor: !newMemoryText.trim() || addingMemory ? "not-allowed" : "pointer",
                    opacity: !newMemoryText.trim() || addingMemory ? 0.6 : 1,
                  }}
                >
                  {addingMemory ? "Adding…" : "Add"}
                </button>
              </div>

              {memoriesError && <p style={{ fontSize: "0.78rem", color: "#f87171", marginBottom: "1rem" }}>{memoriesError}</p>}

              <button
                type="button"
                disabled={memories.length === 0 || clearingAll}
                onClick={() => void handleClearAll()}
                style={{
                  padding: "0.5rem 0.9rem",
                  borderRadius: 8,
                  border: "1px solid rgba(239,68,68,0.3)",
                  background: "rgba(239,68,68,0.1)",
                  color: "#f87171",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: memories.length === 0 || clearingAll ? "not-allowed" : "pointer",
                  opacity: memories.length === 0 || clearingAll ? 0.5 : 1,
                }}
              >
                {clearingAll ? "Clearing…" : "Clear all memories"}
              </button>
            </>
          )}
        </Card>

        {/* Safety note */}
        <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.35)", lineHeight: 1.6, padding: "0 0.25rem" }}>
          Sol will always ask for confirmation before taking a destructive or billing-affecting action on your
          behalf — deleting content, sending payments, and anything similarly irreversible. This is a safety
          guarantee, not a preference, and it cannot be turned off.
        </p>
      </div>
    </>
  );
}
