"use client";

import { useState } from "react";

export type AiBlogPostResult = {
  title: string;
  excerpt: string;
  contentHtml: string;
  metaTitle: string;
  metaDescription: string;
  categories: string[];
  tags: string[];
  imagePrompt: string;
};

function IconSparkle() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      <path d="M19 3v3M20.5 4.5H17.5" />
      <path d="M5 17v2.5M6.25 18.25H3.75" />
    </svg>
  );
}

/**
 * A topic in, a REVIEWABLE draft out — generation never touches the editor's fields
 * directly. The generated post is shown as a preview first (title/excerpt/content/SEO/
 * categories/tags), and only applied via the explicit "Use this content" action, so a
 * result the user doesn't like can be regenerated or dismissed without ever having
 * clobbered what was already in the editor. Purely presentational: all the actual
 * generation/apply logic lives in BlogPostEditor, which already owns every field's state.
 */
export function AiWriteAssistant({
  onGenerate,
  onInsert,
}: {
  onGenerate: (topic: string) => Promise<AiBlogPostResult>;
  onInsert: (result: AiBlogPostResult) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isInserting, setIsInserting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AiBlogPostResult | null>(null);

  async function runGenerate() {
    if (!topic.trim()) {
      setError("Enter a topic first.");
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const result = await onGenerate(topic.trim());
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleInsert() {
    if (!preview) return;
    setIsInserting(true);
    setError(null);
    try {
      await onInsert(preview);
      setOpen(false);
      setTopic("");
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't apply this content.");
    } finally {
      setIsInserting(false);
    }
  }

  function handleDismiss() {
    setPreview(null);
    setError(null);
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
          {!preview && (
            <>
              <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.5)", marginBottom: "0.6rem" }}>
                What should this post be about? Generates the title, content, excerpt, SEO details,
                categories/tags, and a featured image — spends AI credit from your account.
              </p>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  autoFocus
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void runGenerate(); } }}
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
                  onClick={() => void runGenerate()}
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
            </>
          )}
          {error && (
            <p style={{ fontSize: "0.78rem", color: "#f87171", marginTop: "0.6rem" }} role="alert">
              {error}
            </p>
          )}

          {preview && (
            <div>
              <p style={{ fontSize: "0.7rem", fontWeight: 700, color: "rgba(240,242,255,0.4)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.5rem" }}>
                Preview — topic: &quot;{topic}&quot;
              </p>

              <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#f0f2ff", marginBottom: "0.3rem" }}>{preview.title}</h3>
              <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.55)", marginBottom: "0.7rem", fontStyle: "italic" }}>{preview.excerpt}</p>

              <div
                style={{
                  maxHeight: 260, overflowY: "auto", padding: "0.75rem 0.9rem", borderRadius: 8,
                  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                  fontSize: "0.82rem", lineHeight: 1.6, color: "rgba(240,242,255,0.85)", marginBottom: "0.7rem",
                }}
                className="ai-write-preview-content"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: preview.contentHtml }}
              />
              <style>{`
                .ai-write-preview-content h2, .ai-write-preview-content h3 { color: #f0f2ff; font-weight: 800; line-height: 1.3; }
                .ai-write-preview-content h2 { font-size: 1.25em; margin: 0.9em 0 0.4em; }
                .ai-write-preview-content h3 { font-size: 1.08em; margin: 0.8em 0 0.35em; }
                .ai-write-preview-content > *:first-child { margin-top: 0; }
                .ai-write-preview-content > *:last-child { margin-bottom: 0; }
                .ai-write-preview-content p { margin: 0 0 0.75em; }
                .ai-write-preview-content ul, .ai-write-preview-content ol { margin: 0 0 0.75em; padding-left: 1.25em; }
                .ai-write-preview-content li { margin-bottom: 0.3em; }
                .ai-write-preview-content blockquote { margin: 0 0 0.75em; padding-left: 0.9em; border-left: 2px solid rgba(139,92,246,0.4); color: rgba(240,242,255,0.65); }
              `}</style>

              {(preview.categories.length > 0 || preview.tags.length > 0) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.5rem" }}>
                  {preview.categories.map((c) => (
                    <span key={`cat-${c}`} style={{ padding: "0.15rem 0.55rem", borderRadius: 999, background: "rgba(139,92,246,0.15)", color: "var(--brand)", fontSize: "0.7rem", fontWeight: 600 }}>
                      {c}
                    </span>
                  ))}
                  {preview.tags.map((t) => (
                    <span key={`tag-${t}`} style={{ padding: "0.15rem 0.55rem", borderRadius: 999, background: "rgba(255,255,255,0.06)", color: "rgba(240,242,255,0.7)", fontSize: "0.7rem" }}>
                      #{t}
                    </span>
                  ))}
                </div>
              )}

              <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.35)", marginBottom: "0.9rem" }}>
                Featured image (generated on insert): {preview.imagePrompt}
              </p>

              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => void handleInsert()}
                  disabled={isInserting || isGenerating}
                  style={{
                    flex: 1, padding: "0.55rem 1rem", borderRadius: 9, border: "none",
                    background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff",
                    cursor: isInserting || isGenerating ? "not-allowed" : "pointer", opacity: isInserting || isGenerating ? 0.7 : 1,
                    fontSize: "0.82rem", fontWeight: 700, fontFamily: "inherit",
                  }}
                >
                  {isInserting ? "Applying…" : "Use this content"}
                </button>
                <button
                  type="button"
                  onClick={() => void runGenerate()}
                  disabled={isInserting || isGenerating}
                  style={{
                    padding: "0.55rem 1rem", borderRadius: 9, border: "1px solid rgba(139,92,246,0.3)",
                    background: "rgba(139,92,246,0.08)", color: "var(--brand)", cursor: isInserting || isGenerating ? "not-allowed" : "pointer",
                    opacity: isInserting || isGenerating ? 0.7 : 1, fontSize: "0.82rem", fontWeight: 600, fontFamily: "inherit", whiteSpace: "nowrap",
                  }}
                >
                  {isGenerating ? "Writing…" : "Regenerate"}
                </button>
                <button
                  type="button"
                  onClick={handleDismiss}
                  disabled={isInserting || isGenerating}
                  style={{
                    padding: "0.55rem 1rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.12)",
                    background: "transparent", color: "rgba(240,242,255,0.7)", cursor: isInserting || isGenerating ? "not-allowed" : "pointer",
                    fontSize: "0.82rem", fontWeight: 600, fontFamily: "inherit",
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
