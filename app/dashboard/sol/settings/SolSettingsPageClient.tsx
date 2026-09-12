"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Toggle } from "@/app/dashboard/_components/Toggle";
import { CustomSelect } from "@/app/_components/CustomSelect";
import { SolSubpageHeader } from "../_components/SolSubpageHeader";
import type { SolPreferencesData, SolTonePreset, SolModelTier, SolResponseLength } from "./page";

const TONE_OPTIONS: Array<{ value: SolTonePreset; label: string }> = [
  { value: "PROFESSIONAL", label: "Professional" },
  { value: "FRIENDLY", label: "Friendly" },
  { value: "CONCISE", label: "Concise" },
  { value: "DETAILED", label: "Detailed" },
];

const MODEL_TIER_OPTIONS: Array<{ value: SolModelTier; label: string; description: string }> = [
  { value: "BASIC", label: "Standard", description: "Fast, great for everyday tasks" },
  { value: "MEDIUM", label: "Advanced", description: "Stronger reasoning, still quick" },
  { value: "HIGH", label: "Most Capable", description: "Slower, best for complex work" },
];

const RESPONSE_LENGTH_OPTIONS: Array<{ value: SolResponseLength; label: string }> = [
  { value: "CONCISE", label: "Concise" },
  { value: "BALANCED", label: "Balanced" },
  { value: "THOROUGH", label: "Thorough" },
];

/** One consistent row shape for every setting on this page — label + description fixed to
 * a left column, the control fixed to a right column, same width split every time. A
 * single repeated grid (not a mix of eyebrow-labeled blocks, card panels, and free-floating
 * links) is what makes a settings list read as deliberate rather than scattered. */
function Row({ title, description, control, tall }: { title: string; description?: string; control: React.ReactNode; tall?: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "320px 1fr",
        gap: "2.5rem",
        padding: tall ? "1.85rem 0.75rem" : "1.6rem 0.75rem",
        margin: "0 -0.75rem",
        borderRadius: 12,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        alignItems: tall ? "start" : "center",
        transition: "background 0.15s",
      }}
      className="sol-settings-row"
    >
      <div>
        <p style={{ margin: 0, fontSize: "0.92rem", fontWeight: 600, color: "#f5f5ff" }}>{title}</p>
        {description && <p style={{ margin: "0.3rem 0 0", fontSize: "0.81rem", color: "rgba(240,242,255,0.52)", lineHeight: 1.55 }}>{description}</p>}
      </div>
      {/* Controls that already fill the column (segmented choice, the select) are
          unaffected by justify-content; this is what pushes a compact, intrinsically-sized
          control (the toggle, the "Open memory" pill) all the way to the row's right edge
          instead of leaving it stranded right after the label with dead space beyond it. */}
      <div style={tall ? undefined : { display: "flex", justifyContent: "flex-end" }}>{control}</div>
    </div>
  );
}

/** The segmented pill control — same grammar as SolModeSwitch — for every multi-choice
 * setting on the page, so tone/length pickers never revert to a grid of separately-bordered
 * chip buttons. */
function SegmentedChoice<T extends string>({ options, value, onChange }: { options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void }) {
  return (
    // Full-width and fully pill-shaped (container AND each segment) — stretched to fill
    // whatever room the row gives it instead of hugging the left edge and leaving a dead
    // gap to the right, and rounded all the way rather than a lightly-rounded rectangle.
    <div style={{ display: "flex", width: "100%", padding: 4, borderRadius: 999, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0.6rem 1rem",
              borderRadius: 999,
              border: "none",
              fontFamily: "inherit",
              fontSize: "0.82rem",
              fontWeight: 700,
              cursor: "pointer",
              whiteSpace: "nowrap",
              background: active ? "linear-gradient(135deg,var(--brand),var(--brand-deep))" : "transparent",
              color: active ? "#fff" : "rgba(240,242,255,0.5)",
              boxShadow: active ? "0 4px 14px -4px rgba(var(--brand-rgb),0.6)" : "none",
              transition: "background 0.15s, color 0.15s, box-shadow 0.15s",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function SaveStatus({ saving, notice, error }: { saving: boolean; notice: string | null; error: string | null }) {
  const text = saving ? "Saving…" : error ? error : notice ? notice : null;
  if (!text) return null;
  const color = error ? "#f87171" : saving ? "rgba(240,242,255,0.4)" : "#34d399";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.76rem", color, fontWeight: 600 }}>
      {saving && <span className="sol-save-dot" />}
      {text}
    </span>
  );
}

export function SolSettingsPageClient({ initialPreferences }: { initialPreferences: SolPreferencesData }) {
  const [tonePreset, setTonePreset] = useState<SolTonePreset>(initialPreferences.tonePreset ?? "FRIENDLY");
  const [customInstructions, setCustomInstructions] = useState(initialPreferences.customInstructions);
  const [defaultModelTier, setDefaultModelTier] = useState<SolModelTier>(initialPreferences.defaultModelTier);
  const [memoryEnabled, setMemoryEnabled] = useState(initialPreferences.memoryEnabled);
  const [responseLength, setResponseLength] = useState<SolResponseLength>(initialPreferences.responseLength);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(async () => {
      setSaving(true);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch("/api/v1/sol/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tonePreset, customInstructions, defaultModelTier, memoryEnabled, responseLength }),
        });
        if (!response.ok) {
          const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(errorPayload?.error ?? "Unable to save Sol preferences.");
        }
        setNotice("Saved");
        setDirty(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to save Sol preferences.");
      } finally {
        setSaving(false);
      }
    }, 450);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, tonePreset, customInstructions, defaultModelTier, memoryEnabled, responseLength]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      <SolSubpageHeader title="Sol settings" subtitle="Tone, model, and behavior" />

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "2.75rem 2.5rem 4rem" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "1rem", marginBottom: "0.5rem" }}>
            <h1 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: "1.6rem", fontWeight: 700, color: "#f5f5ff" }}>
              How Sol works for you
            </h1>
            <SaveStatus saving={saving} notice={notice} error={error} />
          </div>
          <p style={{ margin: "0 0 1.25rem", fontSize: "0.88rem", color: "rgba(240,242,255,0.5)" }}>
            Applies to every new conversation — override the model per-chat anytime from the composer.
          </p>

          {/* One list, one rhythm, top to bottom — no columns, no nav rail, nothing
              competing for attention. The 280px label column keeps every row's title
              aligned to the same vertical line, which is what actually reads as "placed
              properly" rather than the width of the page itself. */}
          <div>
            <Row title="Tone" description="The baseline voice Sol writes in." control={<SegmentedChoice options={TONE_OPTIONS} value={tonePreset} onChange={(v) => { setTonePreset(v); setDirty(true); }} />} />

            <Row
              title="Custom instructions"
              description="Layered on top of the tone above, the same way custom instructions work in other AI assistants."
              tall
              control={
                <>
                  <textarea
                    value={customInstructions}
                    maxLength={2000}
                    rows={4}
                    placeholder="e.g. Always show code before explaining it. Avoid emoji. Prefer metric units."
                    onChange={(e) => {
                      setCustomInstructions(e.target.value);
                      setDirty(true);
                    }}
                    style={{
                      width: "100%",
                      padding: "0.8rem 0.95rem",
                      borderRadius: 18,
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "rgba(255,255,255,0.03)",
                      color: "rgba(240,242,255,0.9)",
                      fontFamily: "inherit",
                      fontSize: "0.875rem",
                      outline: "none",
                      resize: "vertical",
                      lineHeight: 1.6,
                      boxSizing: "border-box",
                    }}
                  />
                  <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.3)", margin: "0.35rem 0 0", textAlign: "right" }}>{customInstructions.length} / 2000</p>
                </>
              }
            />

            <Row
              title="Default model"
              description="Which tier Sol starts a new conversation on."
              control={
                <CustomSelect
                  value={defaultModelTier}
                  options={MODEL_TIER_OPTIONS}
                  menuWidth={380}
                  className="sol-settings-select"
                  onChange={(v) => {
                    setDefaultModelTier(v as SolModelTier);
                    setDirty(true);
                  }}
                />
              }
            />

            <Row
              title="Response length"
              description="How much detail Sol includes by default."
              control={<SegmentedChoice options={RESPONSE_LENGTH_OPTIONS} value={responseLength} onChange={(v) => { setResponseLength(v); setDirty(true); }} />}
            />

            <Row
              title="Remember things about you"
              description="Preferences, recurring facts, and tone cues, across conversations."
              control={<Toggle checked={memoryEnabled} onChange={(next) => { setMemoryEnabled(next); setDirty(true); }} label="Let Sol remember things about you across conversations" />}
            />

            <Row
              title="Manage what Sol remembers"
              description="View, add, or delete the specific things Sol has stored."
              control={
                <Link
                  href="/dashboard/sol/memory"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    padding: "0.6rem 1.1rem",
                    borderRadius: 999,
                    background: "rgba(var(--brand-rgb),0.14)",
                    border: "1px solid rgba(var(--brand-rgb),0.3)",
                    fontSize: "0.83rem",
                    fontWeight: 700,
                    color: "#e9d5ff",
                    textDecoration: "none",
                  }}
                >
                  Open memory
                  <ChevronRight size={14} />
                </Link>
              }
            />
          </div>

          <p style={{ fontSize: "0.79rem", color: "rgba(240,242,255,0.4)", lineHeight: 1.65, marginTop: "2.25rem" }}>
            Sol will always ask for confirmation before taking a destructive or billing-affecting action on your
            behalf — deleting content, sending payments, and anything similarly irreversible. This is a safety
            guarantee, not a preference, and it cannot be turned off.
          </p>
        </div>
      </div>

      <style>{`
        .sol-save-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: sol-save-pulse 1s infinite ease-in-out; }
        @keyframes sol-save-pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
        /* Full width and fully rounded — same pill language as the segmented controls and
           the composer's own attach/voice/send buttons — instead of CustomSelect's default
           compact, lightly-rounded trigger sitting alone in a wide empty row. */
        .sol-settings-select {
          width: 100% !important;
          border-radius: 999px !important;
          padding: 0.75rem 1.15rem !important;
        }
        /* A quiet hover highlight — the negative margin/padding trick on the row itself
           lets the highlight bleed slightly past the text into real padding instead of a
           hover state that's flush with (and indistinguishable from) the row's own text. */
        .sol-settings-row:hover { background: rgba(255,255,255,0.02); }
        @media (max-width: 700px) {
          .sol-settings-row { grid-template-columns: 1fr !important; gap: 0.6rem !important; }
        }
      `}</style>
    </div>
  );
}
