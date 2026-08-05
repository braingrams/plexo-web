"use client";

import { useState } from "react";

type Props = {
  templateId: string;
  templateKind: "EMAIL" | "LANDING_PAGE";
  currentHtml: string;
  useAi: boolean;
  aiProvider: string;
  aiTier: "AUTO" | "BASIC" | "MEDIUM" | "HIGH";
  subscriptionPlan: string;
  onApply: (html: string) => void;
};

/** AI-mode editing for RAW_UPLOAD templates — same /api/v1/ai/generate endpoint and credit
 * pattern (System AI / BYOK / Host-Managed) every other AI action already uses, just with
 * mode "edit_raw_html" and the current index.html as context instead of builder JSON. */
export function RawAiEditPanel({ templateId, templateKind, currentHtml, useAi, aiProvider, aiTier, subscriptionPlan, onApply }: Props) {
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insufficientCredits, setInsufficientCredits] = useState(false);
  const [result, setResult] = useState<{ summary: string; html: string } | null>(null);

  async function handleGenerate() {
    if (!prompt.trim()) {
      setError("Describe what you'd like to change.");
      return;
    }
    setGenerating(true);
    setError(null);
    setInsufficientCredits(false);
    setResult(null);
    try {
      const res = await fetch("/api/v1/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": "workspace-internal" },
        body: JSON.stringify({
          mode: "edit_raw_html",
          prompt: prompt.trim(),
          templateKind,
          context: { html: currentHtml },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 402) setInsufficientCredits(true);
        throw new Error(data.error ?? "AI generation failed.");
      }
      setResult({ summary: data.summary, html: data.result });
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  if (!useAi) {
    return (
      <div style={{ flex: 1, display: "grid", placeItems: "center", padding: "2rem", textAlign: "center" }}>
        <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", maxWidth: 360 }}>
          AI editing isn&apos;t enabled for this account. Configure an API key with AI enabled in Settings, or
          upgrade your plan.
        </p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "1.25rem", gap: "1rem", maxWidth: 720 }}>
      <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.5)", margin: 0 }}>
        Describe the change you want — the AI edits the full page and shows you the result before anything is
        saved. Uses your regular AI credits ({aiProvider}, {aiTier} tier, {subscriptionPlan} plan).
      </p>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder='e.g. "Make the hero heading shorter and more direct" or "Change the button color to green"'
        rows={3}
        style={{
          width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8, color: "#f0f2ff", padding: "0.75rem", fontSize: "0.85rem", outline: "none",
          fontFamily: "inherit", resize: "vertical",
        }}
      />

      <div>
        <button
          type="button"
          disabled={generating}
          onClick={() => void handleGenerate()}
          style={{
            padding: "0.55rem 1.2rem", borderRadius: 8, fontSize: "0.82rem", fontWeight: 700,
            background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
            border: "none", color: "#fff",
            cursor: generating ? "default" : "pointer", opacity: generating ? 0.7 : 1,
          }}
        >
          {generating ? "Generating…" : "Generate"}
        </button>
      </div>

      {insufficientCredits && (
        <p style={{ color: "#f59e0b", fontSize: "0.8rem" }}>
          ⚠️ Insufficient AI credits — top up or configure your own API key in Settings.
        </p>
      )}
      {error && !insufficientCredits && (
        <p style={{ color: "#f87171", fontSize: "0.8rem" }}>⚠️ {error}</p>
      )}

      {result && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "1rem" }}>
          <p style={{ fontSize: "0.8rem", color: "#34d399", margin: 0 }}>✓ {result.summary}</p>
          <iframe
            srcDoc={result.html}
            title="AI edit preview"
            sandbox=""
            style={{ flex: 1, minHeight: 240, width: "100%", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, background: "#fff" }}
          />
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button
              type="button"
              onClick={() => onApply(result.html)}
              style={{
                padding: "0.5rem 1rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 700,
                background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)", color: "#34d399",
                cursor: "pointer",
              }}
            >
              Apply to index.html
            </button>
            <button
              type="button"
              onClick={() => setResult(null)}
              style={{
                padding: "0.5rem 1rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 600,
                background: "none", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(240,242,255,0.7)",
                cursor: "pointer",
              }}
            >
              Discard
            </button>
          </div>
          <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.35)", margin: 0 }}>
            Applying switches you to the Code tab — click Save there to publish this change.
          </p>
        </div>
      )}
    </div>
  );
}
