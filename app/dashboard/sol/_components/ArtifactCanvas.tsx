"use client";

import { useEffect, useState } from "react";
import { X, ExternalLink, Code2, Eye } from "lucide-react";

export type ActiveArtifact = {
  templateId: string;
  name: string;
  /** The tool result's own publishedUrl, if this page is actually live — shown as a
   * quick "Visit" link alongside "Open in full editor" rather than re-deriving it. */
  publishedUrl?: string | null;
};

type ArtifactPage = { id: string; name: string; kind: string; compiledHtml: string; previewHtml: string };

/** The collapsed form of the canvas — a small, re-openable card (not the split view
 * itself), the same "ran once, now a quiet summary you can expand again" shape a skill
 * invocation has, rather than a panel that pins itself open. Shown whenever an artifact
 * exists but the user (or a fresh page load) isn't currently looking at its full preview. */
export function ArtifactCard({ artifact, onOpen }: { artifact: ActiveArtifact; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.6rem",
        width: "100%",
        padding: "0.65rem 0.85rem",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.09)",
        background: "rgba(255,255,255,0.03)",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
      }}
    >
      <span style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 7, background: "linear-gradient(135deg, var(--brand-light), var(--brand-deep))", color: "#fff", flexShrink: 0 }}>
        <Eye size={13} />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: "0.8rem", fontWeight: 600, color: "#f0f2ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {artifact.name}
      </span>
      <span style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.4)", flexShrink: 0 }}>View preview</span>
    </button>
  );
}

/**
 * SOL's split-screen canvas: a live preview + raw-code view of a page SOL just built,
 * alongside the ongoing conversation — mirroring Claude/ChatGPT's artifact/canvas pattern.
 * Deliberately reuses the exact preview mechanism the template detail page already has
 * (GET /api/templates/[id] -> previewHtml, dropped into a sandboxed iframe) instead of a
 * new renderer — see app/dashboard/templates/[id]/detail/detail-client.tsx for the pattern
 * this mirrors.
 */
export function ArtifactCanvas({ artifact, onClose }: { artifact: ActiveArtifact; onClose: () => void }) {
  const [page, setPage] = useState<ArtifactPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "code">("preview");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPage(null);
    fetch(`/api/templates/${artifact.templateId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Couldn't load this page.");
        const data = (await res.json()) as { page: ArtifactPage };
        if (!cancelled) setPage(data.page);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load this page.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.templateId]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minWidth: 0,
        background: "rgba(12,10,18,0.6)",
        borderLeft: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {/* flexWrap so a narrow (e.g. split-canvas-on-mobile) width doesn't clip the trailing
          controls — title + tabs + Visit + "Open in editor" + close is a lot of
          non-shrinking content for one row on a ~375px screen (found by a mobile audit);
          wrapping to a second line costs a little height, not correctness. */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem", rowGap: "0.5rem", padding: "0.75rem 0.9rem", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "#f0f2ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {page?.name ?? artifact.name}
          </p>
        </div>

        <div className="dash-pill-nav" style={{ flex: "0 0 auto", background: "rgba(255,255,255,0.04)", borderRadius: 999, padding: 3 }}>
          <button
            type="button"
            onClick={() => setTab("preview")}
            className={`dash-pill-nav-item${tab === "preview" ? " active" : ""}`}
            style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.75rem", padding: "0.35rem 0.7rem" }}
          >
            <Eye size={13} /> Preview
          </button>
          <button
            type="button"
            onClick={() => setTab("code")}
            className={`dash-pill-nav-item${tab === "code" ? " active" : ""}`}
            style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.75rem", padding: "0.35rem 0.7rem" }}
          >
            <Code2 size={13} /> Code
          </button>
        </div>

        {artifact.publishedUrl && (
          <a
            href={artifact.publishedUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Visit the published page"
            style={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 999, color: "rgba(240,242,255,0.55)" }}
          >
            <ExternalLink size={15} />
          </a>
        )}
        <a
          href={`/dashboard/templates/${artifact.templateId}`}
          title="Open in the full editor"
          style={{ fontSize: "0.75rem", color: "var(--brand)", whiteSpace: "nowrap", flexShrink: 0 }}
        >
          Open in editor
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 999, border: "none", background: "rgba(255,255,255,0.05)", color: "rgba(240,242,255,0.6)", cursor: "pointer", flexShrink: 0 }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {loading && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "rgba(240,242,255,0.4)", fontSize: "0.8rem" }}>
            Loading…
          </div>
        )}
        {error && !loading && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#f87171", fontSize: "0.8rem", padding: "1rem", textAlign: "center" }}>
            {error}
          </div>
        )}
        {page && !loading && !error && tab === "preview" && (
          <iframe
            key={page.id}
            srcDoc={page.previewHtml}
            title={page.name}
            sandbox=""
            style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
          />
        )}
        {page && !loading && !error && tab === "code" && (
          <pre
            style={{
              margin: 0,
              height: "100%",
              overflow: "auto",
              padding: "1rem",
              fontSize: "0.75rem",
              lineHeight: 1.5,
              color: "rgba(240,242,255,0.75)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              boxSizing: "border-box",
              minWidth: 0,
              maxWidth: "100%",
            }}
          >
            {page.compiledHtml}
          </pre>
        )}
      </div>
    </div>
  );
}
