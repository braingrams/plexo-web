"use client";

import { useEffect, useRef, useState } from "react";

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

function IconArrowUp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/** AI-mode editing for RAW_UPLOAD templates — same /api/v1/ai/generate endpoint and credit
 * pattern (System AI / BYOK / Host-Managed) every other AI action already uses, just with
 * mode "edit_raw_html" and the current index.html as context instead of builder JSON.
 *
 * The empty-state layout intentionally echoes the claude.ai composer — a centered prompt
 * with a big rounded input surface and a circular send button — since this is a chat-style
 * "describe the change" action, not a form field on a settings page. */
export function RawAiEditPanel({ templateKind, currentHtml, useAi, onApply }: Props) {
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insufficientCredits, setInsufficientCredits] = useState(false);
  const [result, setResult] = useState<{ summary: string; html: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the composer as the instruction wraps onto more lines, instead of staying
  // pinned at rows={1} and forcing the user to scroll within a one-line box — capped so a
  // very long paste scrolls inside the box rather than pushing the send button off-screen.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [prompt]);

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

  const canSubmit = prompt.trim().length > 0 && !generating;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto" }}>
      {!result ? (
        <div className="raw-ai-empty" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem 1.25rem", gap: "1.5rem" }}>
          <h2 style={{
            fontFamily: "var(--font-heading), sans-serif", fontSize: "clamp(1.2rem, 5vw, 1.6rem)", fontWeight: 700,
            color: "#f0f2ff", textAlign: "center", margin: 0,
          }}>
            What would you like to change?
          </h2>

          <div style={{ width: "100%", maxWidth: 680 }}>
            <div style={{
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 22, padding: "0.65rem 0.65rem 0.65rem 1.1rem", boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
              display: "flex", alignItems: "flex-end", gap: "0.5rem",
            }}>
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (canSubmit) void handleGenerate();
                  }
                }}
                placeholder='Make the hero heading shorter and more direct, change the button color to green…'
                rows={1}
                autoFocus
                style={{
                  flex: 1, background: "none", border: "none", resize: "none",
                  color: "#f0f2ff", fontSize: "0.95rem", outline: "none", fontFamily: "inherit",
                  lineHeight: 1.5, padding: "0.4rem 0", maxHeight: 200, overflowY: "auto",
                }}
              />
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void handleGenerate()}
                aria-label="Generate"
                style={{
                  width: 32, height: 32, borderRadius: "50%", border: "none",
                  display: "grid", placeItems: "center", flexShrink: 0,
                  background: canSubmit ? "linear-gradient(135deg,var(--brand),var(--brand-deep))" : "rgba(255,255,255,0.08)",
                  color: canSubmit ? "#fff" : "rgba(240,242,255,0.3)",
                  cursor: canSubmit ? "pointer" : "default",
                  transition: "background 0.15s, color 0.15s",
                }}
              >
                {generating ? (
                  <span style={{
                    width: 14, height: 14, borderRadius: "50%",
                    border: "2px solid rgba(255,255,255,0.25)", borderTopColor: "#fff",
                    animation: "spin 0.65s linear infinite",
                  }} />
                ) : (
                  <IconArrowUp />
                )}
              </button>
            </div>

            {insufficientCredits && (
              <p style={{ color: "#f59e0b", fontSize: "0.8rem", textAlign: "center", marginTop: "0.9rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem" }}>
                <IconWarning /> Insufficient AI credits — top up or configure your own API key in Settings.
              </p>
            )}
            {error && !insufficientCredits && (
              <p style={{ color: "#f87171", fontSize: "0.8rem", textAlign: "center", marginTop: "0.9rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem" }}><IconWarning /> {error}</p>
            )}
          </div>

          <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.3)", textAlign: "center", maxWidth: 480, margin: 0 }}>
            The AI edits the full page and shows you the result before anything is saved.
          </p>
        </div>
      ) : (
        <div className="raw-ai-result" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "0.75rem", padding: "1.25rem", maxWidth: 900, margin: "0 auto", width: "100%" }}>
          <p style={{ fontSize: "0.8rem", color: "#34d399", margin: 0, display: "flex", alignItems: "center", gap: "0.35rem" }}><IconCheck /> {result.summary}</p>
          <iframe
            srcDoc={result.html}
            title="AI edit preview"
            sandbox=""
            style={{ flex: 1, minHeight: 240, width: "100%", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, background: "#fff" }}
          />
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
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

      <style jsx>{`
        @media (max-width: 480px) {
          .raw-ai-empty {
            padding: 1.25rem 0.85rem !important;
            gap: 1.1rem !important;
          }
          .raw-ai-result {
            padding: 0.85rem !important;
          }
        }
      `}</style>
    </div>
  );
}
