"use client";

import { useEffect, useRef, useState } from "react";
import type { ExtractedTextNode } from "@/lib/htmlTextExtraction";

type Props = {
  templateId: string;
};

/** Groups consecutive nodes under the same label so the list reads as sections
 * ("Menu item", "Heading", "Button"...) rather than one flat unlabeled list — purely
 * derived from whatever extractTextNodes found, no hardcoded structure. */
function groupByLabel(nodes: ExtractedTextNode[]): { label: string; nodes: ExtractedTextNode[] }[] {
  const groups: { label: string; nodes: ExtractedTextNode[] }[] = [];
  for (const node of nodes) {
    const last = groups[groups.length - 1];
    if (last && last.label === node.label) {
      last.nodes.push(node);
    } else {
      groups.push({ label: node.label, nodes: [node] });
    }
  }
  return groups;
}

/** Finds the element in the preview iframe tagged with this node's id — annotateTextNodesForPreview
 * (lib/htmlTextExtraction.ts) sets data-ptid to a space-separated id list on the containing
 * element, so `~=` matches whether it's the sole id or shared with sibling text runs. */
function findPreviewElement(doc: Document, nodeId: number): HTMLElement | null {
  return doc.querySelector(`[data-ptid~="${nodeId}"]`);
}

export function RawTextContentEditor({ templateId }: Props) {
  const [nodes, setNodes] = useState<ExtractedTextNode[] | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState<number | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewReadyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch(`/api/v1/templates/${templateId}/text-content`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load text content.");
        return res.json();
      })
      .then((data: { nodes: ExtractedTextNode[]; previewHtml: string }) => {
        if (cancelled) return;
        setNodes(data.nodes);
        setPreviewHtml(data.previewHtml);
        setDrafts(Object.fromEntries(data.nodes.map((n) => [n.id, n.text])));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load text content.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  // Highlight + scroll to whichever field is focused. Re-runs on every activeNodeId change;
  // previewReadyRef gates it until the iframe has actually finished loading previewHtml, since
  // contentDocument is a blank same-origin doc (not the srcDoc content) until then.
  useEffect(() => {
    if (activeNodeId === null || !previewReadyRef.current) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    doc.querySelectorAll(".plexo-active").forEach((el) => el.classList.remove("plexo-active"));
    const target = findPreviewElement(doc, activeNodeId);
    if (target) {
      target.classList.add("plexo-active");
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeNodeId]);

  function handlePreviewLoad() {
    previewReadyRef.current = true;
    if (activeNodeId !== null) {
      const doc = iframeRef.current?.contentDocument;
      const target = doc ? findPreviewElement(doc, activeNodeId) : null;
      if (target) target.classList.add("plexo-active");
    }
  }

  function handleDraftChange(node: ExtractedTextNode, value: string) {
    setDrafts((prev) => ({ ...prev, [node.id]: value }));

    // Only live-patch the preview when this element's data-ptid is exactly this one id —
    // if it's shared with sibling text runs (space-separated), overwriting textContent
    // would blow away nested markup (e.g. "Some <a>link</a> text."), so leave those as
    // highlight-and-scroll only, not live-typed.
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !previewReadyRef.current) return;
    const target = findPreviewElement(doc, node.id);
    if (target && target.getAttribute("data-ptid") === String(node.id)) {
      target.textContent = value;
    }
  }

  const dirty = nodes?.some((n) => drafts[n.id] !== n.text) ?? false;

  async function handleSave() {
    if (!nodes) return;
    setSaving(true);
    setSaveError(null);
    try {
      const edits = nodes
        .filter((n) => drafts[n.id] !== n.text)
        .map((n) => ({ id: n.id, text: drafts[n.id] }));
      const res = await fetch(`/api/v1/templates/${templateId}/text-content`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edits }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Save failed.");
      setNodes((prev) => prev?.map((n) => ({ ...n, text: drafts[n.id] ?? n.text })) ?? null);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: "grid", placeItems: "center", color: "rgba(240,242,255,0.4)" }}>
        Loading text content…
      </div>
    );
  }
  if (loadError) {
    return (
      <div style={{ flex: 1, display: "grid", placeItems: "center", color: "#f87171" }}>
        {loadError}
      </div>
    );
  }
  if (!nodes || nodes.length === 0) {
    return (
      <div style={{ flex: 1, display: "grid", placeItems: "center", color: "rgba(240,242,255,0.4)" }}>
        No editable text found in this page.
      </div>
    );
  }

  const groups = groupByLabel(nodes);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.75rem 1.25rem", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0,
      }}>
        <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.5)", margin: 0 }}>
          Every piece of visible text on this page — edit and save without touching markup. Click a
          field to see exactly where it is on the page.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          {saveError && <span style={{ color: "#f87171", fontSize: "0.78rem" }}>⚠️ {saveError}</span>}
          {savedFlash && <span style={{ color: "#34d399", fontSize: "0.78rem" }}>✓ Saved</span>}
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void handleSave()}
            className="btn-primary"
            style={{
              padding: "0.45rem 1.1rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 700,
              background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
              border: "none", color: "#fff",
              cursor: !dirty || saving ? "default" : "pointer",
              opacity: !dirty || saving ? 0.5 : 1,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="raw-text-editor-split" style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "1.25rem", maxWidth: 520 }}>
          {groups.map((group, gi) => (
            <div key={gi} style={{ marginBottom: "1.5rem" }}>
              <p style={{
                fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                color: "rgba(240,242,255,0.35)", marginBottom: "0.6rem",
              }}>
                {group.label}{group.nodes.length > 1 ? ` (${group.nodes.length})` : ""}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                {group.nodes.map((node) => {
                  const long = node.text.length > 80;
                  const value = drafts[node.id] ?? node.text;
                  const changed = value !== node.text;
                  const isActive = activeNodeId === node.id;
                  const inputStyle: React.CSSProperties = {
                    width: "100%",
                    background: "rgba(255,255,255,0.04)",
                    border: isActive
                      ? "1px solid #8b5cf6"
                      : changed ? "1px solid rgba(139,92,246,0.4)" : "1px solid rgba(255,255,255,0.1)",
                    boxShadow: isActive ? "0 0 0 3px rgba(139,92,246,0.2)" : "none",
                    borderRadius: 8,
                    color: "#f0f2ff",
                    padding: "0.6rem 0.75rem",
                    fontSize: "0.85rem",
                    outline: "none",
                    fontFamily: "inherit",
                  };
                  return long ? (
                    <textarea
                      key={node.id}
                      value={value}
                      rows={3}
                      onFocus={() => setActiveNodeId(node.id)}
                      onChange={(e) => handleDraftChange(node, e.target.value)}
                      style={inputStyle}
                    />
                  ) : (
                    <input
                      key={node.id}
                      type="text"
                      value={value}
                      onFocus={() => setActiveNodeId(node.id)}
                      onChange={(e) => handleDraftChange(node, e.target.value)}
                      style={inputStyle}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="raw-text-editor-preview" style={{
          flex: 1, minWidth: 0, borderLeft: "1px solid rgba(255,255,255,0.08)",
          background: "#fff", position: "relative",
        }}>
          {previewHtml !== null && (
            <iframe
              ref={iframeRef}
              title="Live preview"
              srcDoc={previewHtml}
              onLoad={handlePreviewLoad}
              // allow-same-origin (no allow-scripts) — read/write DOM access is needed to
              // highlight/scroll/live-patch text, but nothing in this untrusted page can execute.
              sandbox="allow-same-origin"
              style={{ width: "100%", height: "100%", border: "none" }}
            />
          )}
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 900px) {
          .raw-text-editor-split {
            flex-direction: column;
          }
          .raw-text-editor-preview {
            border-left: none !important;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            min-height: 260px;
          }
        }
      `}</style>
    </div>
  );
}
