"use client";

import { useEffect, useState } from "react";

type PageSummary = { id: string; order: number; kind: "WELCOME" | "VIDEO" | "DOCUMENT" | "IMAGE"; title: string; unlocked: boolean; completed: boolean; awaitingApproval: boolean };
type PageContent = {
  id: string;
  kind: PageSummary["kind"];
  title: string;
  contentMode?: "SIMPLE" | "RAW_HTML" | "ADVANCED";
  bodyHtml: string | null;
  designTemplateId: string | null;
  youtubeVideoId: string | null;
  assetUrl: string | null;
  assetFileName: string | null;
};

const KIND_ICON: Record<PageSummary["kind"], string> = { WELCOME: "👋", VIDEO: "▶", DOCUMENT: "📄", IMAGE: "🖼" };

/** The learner's ongoing home — Udemy-style sidebar (lock/checkmark/current-page icons per
 * page, driven by the rule engine's already-computed unlock state) + a main panel for the
 * current page's content. A returning visitor with a valid session cookie lands here
 * directly, with no re-entering email — see the Funnel/LMS plan's visitor-facing flow. */
export function PortalClient({ templateId, funnelName, showWelcome }: { templateId: string; funnelName: string; showWelcome: boolean }) {
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [content, setContent] = useState<PageContent | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [showBanner, setShowBanner] = useState(showWelcome);

  async function loadPages() {
    const res = await fetch(`/api/public/lms/${templateId}/me`);
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setPages(body.pages);
      if (!activePageId) {
        const firstUnfinished = body.pages.find((p: PageSummary) => p.unlocked && !p.completed) ?? body.pages.find((p: PageSummary) => p.unlocked);
        if (firstUnfinished) setActivePageId(firstUnfinished.id);
      }
    }
  }

  useEffect(() => {
    loadPages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  useEffect(() => {
    if (!activePageId) return;
    setLoadingContent(true);
    setContent(null);
    fetch(`/api/public/lms/${templateId}/pages/${activePageId}`)
      .then((res) => res.json())
      .then((body) => setContent(body.error ? null : body))
      .finally(() => setLoadingContent(false));
  }, [templateId, activePageId]);

  async function markComplete() {
    if (!activePageId) return;
    setCompleting(true);
    try {
      await fetch(`/api/public/lms/${templateId}/pages/${activePageId}/complete`, { method: "POST" });
      await loadPages();
      const currentIndex = pages?.findIndex((p) => p.id === activePageId) ?? -1;
      const next = pages?.[currentIndex + 1];
      if (next) setActivePageId(next.id);
    } finally {
      setCompleting(false);
    }
  }

  if (!pages) {
    return <div style={{ minHeight: "100vh", background: "#0b0d16" }} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0b0d16", color: "#f0f2ff", display: "flex" }}>
      <aside style={{ width: 280, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.08)", padding: "1.25rem 1rem", overflowY: "auto" }}>
        <div style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "1.25rem", padding: "0 0.4rem" }}>{funnelName}</div>
        {pages.map((page) => {
          const isActive = page.id === activePageId;
          return (
            <button
              key={page.id}
              type="button"
              disabled={!page.unlocked}
              onClick={() => setActivePageId(page.id)}
              style={{
                display: "flex", alignItems: "center", gap: "0.6rem", width: "100%", textAlign: "left",
                padding: "0.6rem 0.5rem", borderRadius: 9, marginBottom: "0.15rem", border: "none",
                background: isActive ? "rgba(139,92,246,0.16)" : "transparent",
                color: page.unlocked ? "#f0f2ff" : "rgba(240,242,255,0.35)",
                cursor: page.unlocked ? "pointer" : "not-allowed",
                fontSize: "0.83rem", fontWeight: isActive ? 600 : 500,
              }}
            >
              <span style={{ width: 20, textAlign: "center", flexShrink: 0 }}>
                {page.completed ? "✅" : page.unlocked ? KIND_ICON[page.kind] : "🔒"}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{page.title}</span>
            </button>
          );
        })}
      </aside>

      <main style={{ flex: 1, padding: "2rem", maxWidth: 760, margin: "0 auto" }}>
        {showBanner && (
          <div style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 12, padding: "0.8rem 1.1rem", marginBottom: "1.5rem", fontSize: "0.85rem", color: "#c4b5fd", display: "flex", justifyContent: "space-between", gap: "1rem" }}>
            <span>You're in! Bookmark this page to come back anytime.</span>
            <button type="button" onClick={() => setShowBanner(false)} style={{ background: "none", border: "none", color: "#c4b5fd", cursor: "pointer" }}>×</button>
          </div>
        )}

        {loadingContent && <div style={{ color: "rgba(240,242,255,0.4)" }}>Loading…</div>}

        {!loadingContent && content && (
          <div>
            {content.contentMode !== "ADVANCED" && <h1 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "1.25rem" }}>{content.title}</h1>}

            {content.kind === "WELCOME" && content.contentMode === "ADVANCED" && (
              // The design Template's own compiledHtml is already sanitized by the ordinary
              // save pipeline (same one every BUILDER page goes through) — an iframe (not
              // srcDoc) so the unlock check re-runs server-side on every load, same as every
              // other page-content fetch.
              <iframe
                src={`/api/public/lms/${templateId}/pages/${content.id}/design`}
                style={{ width: "100%", minHeight: "70vh", border: "none", borderRadius: 12, marginBottom: "1.5rem" }}
                title={content.title}
              />
            )}

            {content.kind === "WELCOME" && content.contentMode !== "ADVANCED" && content.bodyHtml && (
              <div
                style={{ fontSize: "0.95rem", lineHeight: 1.7, color: "rgba(240,242,255,0.8)", marginBottom: "1.5rem" }}
                dangerouslySetInnerHTML={{ __html: content.bodyHtml }}
              />
            )}

            {content.kind === "VIDEO" && content.youtubeVideoId && (
              <div style={{ aspectRatio: "16/9", borderRadius: 12, overflow: "hidden", marginBottom: "1.5rem" }}>
                <iframe
                  src={`https://www.youtube.com/embed/${content.youtubeVideoId}`}
                  style={{ width: "100%", height: "100%", border: "none" }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}

            {(content.kind === "DOCUMENT" || content.kind === "IMAGE") && content.assetUrl && (
              content.kind === "IMAGE" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={content.assetUrl} alt={content.title} style={{ maxWidth: "100%", borderRadius: 12, marginBottom: "1.5rem" }} />
              ) : (
                <a href={content.assetUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", padding: "0.7rem 1.1rem", borderRadius: 10, background: "rgba(139,92,246,0.15)", color: "var(--brand, #c4b5fd)", textDecoration: "none", marginBottom: "1.5rem", fontSize: "0.88rem", fontWeight: 600 }}>
                  Open {content.assetFileName ?? "document"}
                </a>
              )
            )}

            <button
              type="button"
              onClick={markComplete}
              disabled={completing}
              style={{ padding: "0.65rem 1.3rem", borderRadius: 10, fontSize: "0.88rem", fontWeight: 700, background: "var(--brand, #8b5cf6)", color: "#fff", border: "none", cursor: "pointer" }}
            >
              {completing ? "Saving…" : "Mark complete & continue"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
