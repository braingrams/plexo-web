"use client";

import { useState } from "react";

function IconSparkle() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      <path d="M19 3v3M20.5 4.5H17.5" />
      <path d="M5 17v2.5M6.25 18.25H3.75" />
    </svg>
  );
}

/** A topic in, fully-written post out — title/content/excerpt/SEO/category/tag/featured
 * image, all applied to the parent editor's fields via `onGenerate`. Purely presentational:
 * all the actual generation/apply logic lives in BlogPostEditor, which already owns every
 * field's state. */
export function AiWriteAssistant({ onGenerate }: { onGenerate: (topic: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!topic.trim()) {
      setError("Enter a topic first.");
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      await onGenerate(topic.trim());
      setOpen(false);
      setTopic("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div style={{ marginBottom: "1rem" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex", alignItems: "center", gap: "0.45rem",
          padding: "0.5rem 0.9rem", borderRadius: 9, border: "1px solid rgba(139,92,246,0.3)",
          background: "rgba(139,92,246,0.1)", color: "var(--brand)", cursor: "pointer",
          fontSize: "0.8rem", fontWeight: 700, fontFamily: "inherit",
        }}
      >
        <IconSparkle />
        AI Write for Me
      </button>

      {open && (
        <div style={{
          marginTop: "0.6rem", padding: "1rem", borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)",
        }}>
          <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.5)", marginBottom: "0.6rem" }}>
            What should this post be about? Generates the title, content, excerpt, SEO details,
            categories/tags, and a featured image — spends AI credit from your account.
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              autoFocus
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleGenerate(); } }}
              placeholder="e.g. 5 ways to speed up your onboarding flow"
              disabled={isGenerating}
              style={{
                flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 9, color: "#f0f2ff", padding: "0.55rem 0.75rem", fontSize: "0.85rem",
                outline: "none", fontFamily: "inherit",
              }}
            />
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={isGenerating}
              style={{
                padding: "0.55rem 1.1rem", borderRadius: 9, border: "none",
                background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff",
                cursor: isGenerating ? "not-allowed" : "pointer", opacity: isGenerating ? 0.7 : 1,
                fontSize: "0.85rem", fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap",
              }}
            >
              {isGenerating ? "Writing…" : "Generate"}
            </button>
          </div>
          {error && (
            <p style={{ fontSize: "0.78rem", color: "#f87171", marginTop: "0.6rem" }} role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
