"use client";

import { useEffect, useState } from "react";

function IconClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/**
 * Full-screen preview modal for a marketplace listing — fetches compiledHtml on demand
 * from /api/v1/marketplace/templates/:id/preview and renders it in a decorative
 * (non-interactive) sandboxed iframe, same isolation as the dashboard's own template
 * thumbnails (app/dashboard/templates/TemplateCard.tsx): no allow-scripts / allow-same-
 * origin, since compiledHtml can be raw, unsanitized RAW_UPLOAD HTML.
 */
export function TemplatePreviewModal({ templateId, onClose }: { templateId: string; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    fetch(`/api/v1/marketplace/templates/${templateId}/preview`)
      .then((res) => {
        if (!res.ok) throw new Error("Couldn't load preview.");
        return res.json();
      })
      .then((data: { html: string; name: string }) => {
        if (cancelled) return;
        setHtml(data.html);
        setName(data.name);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load preview.");
      });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9999,
        display: "flex", flexDirection: "column", padding: "3vh 4vw",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex", flexDirection: "column", flex: 1,
          background: "#0f1422", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 16, overflow: "hidden", boxShadow: "0 30px 100px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0.85rem 1.25rem", borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}>
          <span style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.7)" }}>
            {name ? <>Previewing <strong style={{ color: "#f0f2ff" }}>{name}</strong></> : "Loading preview…"}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            style={{ background: "none", border: "none", color: "rgba(240,242,255,0.6)", cursor: "pointer", padding: "0.25rem" }}
          >
            <IconClose />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, position: "relative", background: "#fff" }}>
          {error ? (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#f87171", background: "#0f1422", fontSize: "0.85rem" }}>
              {error}
            </div>
          ) : html === null ? (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "#0f1422", color: "rgba(240,242,255,0.4)", fontSize: "0.85rem" }}>
              Loading preview…
            </div>
          ) : (
            <iframe
              title={`Preview ${name ?? ""}`}
              srcDoc={html}
              sandbox=""
              style={{ width: "100%", height: "100%", border: "none" }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
